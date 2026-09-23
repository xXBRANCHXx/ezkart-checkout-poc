#!/usr/bin/env python3
"""Run one generator -> builder integrator batch, preserving prompts and evidence."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
RUNS = Path.home() / '.local/share/ezkart-elements/runs'


def now():
    return datetime.now(timezone.utc).isoformat()


def write_json(path, data):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, indent=2) + '\n')
    temporary.replace(path)


def update(run, **fields):
    path = run / 'status.json'
    state = json.loads(path.read_text()) if path.exists() else {}
    state.update(fields, updated_at=now())
    write_json(path, state)
    return state


def get_run(value):
    return Path(value).expanduser().resolve() if value else Path((RUNS / 'latest').read_text().strip())


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def verify_pack(run, target):
    pack = json.loads((run / 'pack.json').read_text())
    inventory = json.loads((run / 'inventory.json').read_text())
    if not isinstance(pack, list):
        raise ValueError('pack.json must contain an array')
    categories = {item['id'] for item in inventory['categories']}
    ids = {item['id'] for item in inventory['definitions']}
    counts = Counter(item['category'] for item in inventory['definitions'])
    for item in pack:
        category = item.get('category')
        if category not in categories or not isinstance(item.get('id'), str) or not item['id'].startswith(category + '-'):
            raise ValueError(f'Invalid category or category-prefixed ID: {item.get("id")}')
        if item['id'] in ids:
            raise ValueError(f'Duplicate ID: {item["id"]}')
        ids.add(item['id'])
        if not all(isinstance(item.get(key), str) and item[key].strip() for key in ['name','description']):
            raise ValueError(f'Missing name/description: {item["id"]}')
        if not isinstance(item.get('node'), dict) or not item['node'].get('type'):
            raise ValueError(f'Missing native node: {item["id"]}')
        counts[category] += 1
    if any(counts[category] < target for category in categories):
        raise ValueError(f'Incomplete collection: {dict(counts)}; target {target}')
    if not (run / 'handoff.md').is_file():
        raise ValueError('Generator handoff.md is missing')
    return dict(counts)


def stage(run, name, target, yolo):
    prompt = (HERE / f'{name}.md').read_text().replace('RUN_DIRECTORY', str(run)).replace('TARGET_COUNT', str(target))
    (run / f'{name}-prompt.md').write_text(prompt)
    args = ['codex','exec','--dangerously-bypass-approvals-and-sandbox'] if yolo else ['codex','exec','--sandbox','workspace-write','-c','approval_policy="never"']
    args += ['-C',str(REPO),'--add-dir',str(run),'--json','--color','never','-o',str(run / f'{name}-last-message.md'),'-']
    update(run, phase=name, command=args, phase_started_at=now())
    with (run / f'{name}.jsonl').open('w') as output, (run / f'{name}.stderr.log').open('w') as errors:
        proc = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=output, stderr=errors, text=True, cwd=REPO)
        update(run, agent_pid=proc.pid)
        try:
            proc.communicate(prompt, timeout=6 * 3600)
        except subprocess.TimeoutExpired:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
            raise RuntimeError(f'{name} exceeded its six-hour batch limit')
    if proc.returncode:
        raise RuntimeError(f'{name} exited {proc.returncode}; inspect {name}.stderr.log and {name}.jsonl')
    update(run, agent_pid=None)


def worker(run, target, yolo):
    with (RUNS / 'worker.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            update(run, phase='failed', error='Another element batch is running.')
            return 1
        update(run, phase='starting', pid=os.getpid(), repository=str(REPO), target=target, yolo=yolo, started_at=now())
        def terminate(_number, _frame):
            update(run, phase='stopped', finished_at=now())
            raise SystemExit(130)
        signal.signal(signal.SIGTERM, terminate)
        signal.signal(signal.SIGINT, terminate)
        try:
            inventory = subprocess.check_output(['node',str(HERE / 'inventory.mjs'),str(REPO)],text=True)
            (run / 'inventory.json').write_text(inventory)
            stage(run,'generator',target,yolo)
            update(run, phase='handoff', category_counts=verify_pack(run,target))
            stage(run,'integrator',target,yolo)
            if not (run / 'integration-report.md').is_file():
                raise RuntimeError('Integrator did not leave integration-report.md')
            update(run, phase='verifying')
            with (run / 'final-tests.log').open('w') as output:
                result = subprocess.run(['node','--test','tools/builder-mcp/test/asset-packs.test.mjs'],cwd=REPO,stdout=output,stderr=subprocess.STDOUT,timeout=1800)
            if result.returncode:
                raise RuntimeError('Final pack checks failed; inspect final-tests.log')
            current = json.loads(subprocess.check_output(['node',str(HERE / 'inventory.mjs'),str(REPO)],text=True))
            counts = Counter(item['category'] for item in current['definitions'])
            expected = json.loads((run / 'inventory.json').read_text())['categories']
            if any(counts[item['id']] < target for item in expected):
                raise RuntimeError(f'Integrated collection is incomplete: {dict(counts)}')
            update(run, phase='complete', category_counts=dict(counts), total=len(current['definitions']), finished_at=now())
        except Exception as error:
            update(run, phase='failed', error=str(error), finished_at=now())
            return 1
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['start','status','stop','worker'])
    parser.add_argument('--target',type=int,default=20,help='Minimum total designs per existing category')
    parser.add_argument('--yolo',action='store_true',help='Use user-authorized approval and sandbox bypass')
    parser.add_argument('--run',help='Run directory (status/stop default to latest)')
    args = parser.parse_args()
    if not 3 <= args.target <= 100:
        parser.error('--target must be between 3 and 100 per category for one bounded batch')
    RUNS.mkdir(parents=True,exist_ok=True)
    if args.action == 'start':
        with (RUNS / 'worker.lock').open('a') as lock:
            try:
                fcntl.flock(lock,fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                parser.error('An element batch is already running. Inspect it with status.')
        run = RUNS / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        run.mkdir()
        update(run,phase='queued',repository=str(REPO),target=args.target,yolo=args.yolo)
        command = [sys.executable,str(Path(__file__).resolve()),'worker','--target',str(args.target),'--run',str(run)]
        if args.yolo:
            command.append('--yolo')
        with (run / 'runner.log').open('w') as output:
            process = subprocess.Popen(command,cwd=REPO,stdin=subprocess.DEVNULL,stdout=output,stderr=subprocess.STDOUT,start_new_session=True)
        (RUNS / 'latest').write_text(str(run)+'\n')
        print(json.dumps({'pid':process.pid,'run':str(run),'status':str(run/'status.json')},indent=2))
        return 0
    run = get_run(args.run)
    if args.action == 'worker':
        return worker(run,args.target,args.yolo)
    state = json.loads((run / 'status.json').read_text())
    if args.action == 'stop':
        if state.get('phase') in ['complete','failed','stopped']:
            parser.error(f'Run already ended: {state["phase"]}')
        if state.get('pid') and alive(state['pid']):
            os.killpg(state['pid'],signal.SIGTERM)
            time.sleep(0.2)
            state = json.loads((run / 'status.json').read_text())
    state['running'] = bool(state.get('pid') and alive(state['pid']) and state['phase'] not in ['complete','failed','stopped'])
    state['run'] = str(run)
    print(json.dumps(state,indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
