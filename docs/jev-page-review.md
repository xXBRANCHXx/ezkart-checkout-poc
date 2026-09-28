# Jev reports and page review — owner request

On 28 September 2026 the owner requested Jev for reports and flagged-page review,
then proposed OpenRouter. A dedicated **Ezkart Jev Beta** OpenRouter API key was
created with a **USD 5 total limit**, no periodic reset, and expiry on
**27 December 2026**. It has not been installed in Ezkart or used for model calls.
The secret is held in private local storage outside this repository. No key,
email code, bank information, seller ID image or account credential belongs here.

The owner subsequently separated age calculation from AI: ordinary software
calculates the 18+ threshold from a date of birth. This does not establish that an
ID is authentic or belongs to its presenter. Jev is not selected as Ezkart's
identity-verification evidence source. See [seller onboarding](seller-onboarding.md).

## Requested page lifecycle

The owner wants a flagged page archived while its seller makes changes, followed
by re-scans. The owner specified at most three re-scans and at most five days,
with the ability to terminate the page manually earlier. The outstanding
clarification is whether the third failed re-scan terminates immediately or
only exhausts retries until the five-day deadline. A successful corrected page
must have a result tied to the exact scanned revision; later edits cannot inherit
that result. Retries caused by transport errors must not consume a new re-scan.

This is a recorded requirement, not deployed moderation code. OpenRouter gives
access to models; an API key alone does not provide a report inbox, page scanner,
policy, enforcement scheduler or appeal/review record. A model and content policy
have not yet been selected. Do not silently turn a model's free-form opinion into
page deletion or verified identity.

The intended implementation should treat page/report text as untrusted content,
return constrained evidence-linked findings, and apply the owner's lifecycle in
ordinary application code. Account/store/page scope, original deadline, revision,
re-scan count, decisions and manual actions need an audited record. Public page
termination must not erase customer orders, financial records or moderation
evidence. Public canonical and custom-domain reads must honor the same state;
the seller still needs private access to make corrections while archived.

Real model requests and automatic enforcement have not been enabled. No customer
or identity data has been sent to OpenRouter by this work.
