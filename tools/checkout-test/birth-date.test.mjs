import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from '../builder-mcp/node_modules/playwright/index.mjs';
test('branded birth date picker supports leap dates, keyboard entry and narrow screens',async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:390,height:800}});
 const css=await readFile(new URL('../../cart/admin/birth-date.css',import.meta.url),'utf8');
 await page.setContent(`<style>${css}</style><body data-admin-language="en"><form><label for="dob">Date of birth</label><div class="birth-date-field"><input id="dob" data-birth-date required><button type="button" aria-label="Choose date of birth">Calendar</button></div></form></body>`);
 await page.addScriptTag({content:await readFile(new URL('../../cart/admin/birth-date.js',import.meta.url),'utf8')});
 const open=()=>page.getByRole('button',{name:'Choose date of birth'}).click();
 await open();const box=await page.locator('dialog').boundingBox();assert(box.x>=0&&box.x+box.width<=390);
 await page.getByLabel('Birth year',{exact:true}).selectOption('2000');await page.getByLabel('Birth month',{exact:true}).selectOption('1');
 await page.getByRole('button',{name:'29 February 2000',exact:true}).click();assert.equal(await page.locator('#dob').inputValue(),'2000-02-29');
 await open();await page.keyboard.press('Escape');assert.equal(await page.locator('dialog').isVisible(),false);
 await page.locator('#dob').fill('2001-02-29');assert.equal(await page.locator('#dob').evaluate(e=>e.checkValidity()),false);
 await page.locator('#dob').fill('1990-01-15');await open();await page.getByRole('button',{name:'15 January 1990',exact:true}).focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');assert.equal(await page.locator('#dob').inputValue(),'1990-01-16');
 await open();await page.getByRole('button',{name:'Clear date',exact:true}).click();assert.equal(await page.locator('#dob').inputValue(),'');assert.equal(await page.locator('#dob').evaluate(e=>e.checkValidity()),false);
});
