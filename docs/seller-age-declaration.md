# Storing seller age is not a promise of full ID verification

The owner clarified on 28 September 2026 that Ezkart's government declaration
said it would **store a seller's age**, not verify their identity. The earlier
implementation treated the owner's tentative “I guess we need ID-checking” as
a settled requirement and introduced an empty identity-evidence gate. That was
an overreach. The owner corrected that requirement before migration 0071 was
deployed. DOB-only onboarding is now delivered in commit `2e6e49c`; the abandoned
identity-number follow-up was not integrated.

## Checked sources and narrow conclusion

[Permenkominfo 5/2020, Article 3(4)(g)](https://jdih.komdigi.go.id/produk_hukum/view/id/759/t/peraturan+menteri+komunikasi+dan+informatika+nomor+5+tahun+2020)
asks for a description of the personal data processed in the registration's
general system information. Listing age in that field describes a data category;
the clause does not itself prescribe ID-document checking or biometric identity
verification. This is the interpretation of that registration provision, not an
exemption from other laws.

[Law 27/2022, Article 29](https://jdih.komdigi.go.id/produk_hukum/view/id/832/t/crc32/)
separately requires controllers to ensure and verify data accuracy, completeness
and consistency. That clause does not specify KTP uploads, selfies or a particular
identity-verification service for every age field. It also does not establish
that collecting a self-declared birthday necessarily satisfies every applicable
verification obligation. Child-protection, commerce and DOKU account requirements
are distinct questions, not implications of listing age in a PSE form.

The available local PSE certificate repeats the registration's personal-data
description requirement but does not reproduce the owner's exact entered age
answer. This conclusion uses the owner's account of that answer; it is not a
claim that the complete submitted form was retrieved and reviewed.

## Implementation scope

Keep owner-approved minimum 18, deterministic Indonesian-calendar age calculation,
versioned declared DOB, verified login email, owner/MFA, saved bank and confirmed
pickup/return address pins. Label the age as declared and the calculation as a
calculation. Do not mark identity verified or collect ID images based solely on
the PSE age-storage statement. The premature mandatory identity gate was removed
before deployment. Existing payment-provider, beneficiary, financial
execution and public-release holds remain separate and unchanged.

Jev/OpenRouter remains scoped to reports and page flags. Creating its API key
does not approve identity processing, external model calls or automatic page
termination.

## Latest owner decision

The owner briefly considered collecting an ID image or NIK/passport number, then
reversed that request and asked to keep DOB input only, conditional on compliance.
The identity-number follow-up was stopped before integration or deployment.
Current onboarding continues to record declared DOB and calculate age; no ID
number or document image is collected. Applicability of separate age-assurance,
commerce and DOKU requirements must be assessed before claiming DOB alone is
sufficient for legal/provider compliance.


## Narrow legal/provider review — 28 September 2026

**Finding:** the reviewed primary sources do not establish a universal requirement
for Ezkart to collect every seller's NIK, ID photograph or selfie solely because
it records DOB. They also do not establish that unchecked self-declared DOB and
contact details satisfy all applicable duties. Keep the owner-approved DOB-only
implementation; do not describe it as independently verified identity, final
legal clearance, or protection against all lawsuits.

[PP 80/2019, Articles 9 and 13](https://peraturan.go.id/id/pp-no-80-tahun-2019)
requires clear legal-subject identity and truthful identity information supported
by valid data or documents. Those provisions do not prescribe one universal
ID-upload mechanism for every marketplace seller. Full name, verified email,
phone, a saved bank and confirmed map pins are useful records, but their mere
presence does not establish that the legal identity or bank ownership was checked.
The separate PDP Article 29 verification duty above still applies; deterministic
DOB arithmetic verifies an age calculation, not the truth of the entered DOB.

[PP 17/2025, Articles 2–4](https://peraturan.go.id/id/pp-no-17-tahun-2025)
extends child protection to private electronic products that may be used or
accessed by children, not only services intentionally marketed to them. Article
4 uses indicators including terms, regular child use, advertising, design and
substantial similarity to products used by children. An adult-seller rule alone
therefore cannot establish that Ezkart's public storefront/buyer features fall
outside the rule. Article 2 includes a child-user verification mechanism.
Article 49 provides adaptation within two years of promulgation on 27 March 2025;
it is not evidence of a blanket beta exemption or a finding that DOB alone is
adequate.

The official [Komdigi catalog](https://jdih.komdigi.go.id/produk_hukum/view/id/1007/t/peraturan+menteri+komunikasi+dan+digital+nomor+9+tahun+2026)
and [national regulation catalog](https://peraturan.go.id/id/permenkomdigi-no-9-tahun-2026)
list implementing Permenkomdigi 9/2026 as effective from 6 March 2026, BN 163.
However, the PDF downloads checked from Komdigi, peraturan.go.id and
[BPK](https://peraturan.bpk.go.id/Download/409395/Permenkomdigi-no-9-tahun-2026.pdf)
all contain `RANCANGAN` and incomplete promulgation fields. No clean final copy
was obtained in this bounded check. Do not quote that draft's detailed age-method
clauses as the verified enacted text. The catalog establishes that a regulation
exists; the publication inconsistency needs resolution before relying on its
exact implementation wording or deadlines.

DOKU's current [Sub-Account product page](https://docs.doku.com/wallet-as-a-service/sub-account)
expressly covers **V2**. Its [creation guide](https://docs.doku.com/wallet-as-a-service/sub-account/account-management)
lists a platform reference, account-holder name, account type, optional parent
profile and optional email/phone. It does not list DOB, NIK, ID photo or selfie
as universal creation inputs. Its [FAQ](https://docs.doku.com/wallet-as-a-service/sub-account/faq)
says Sub-Account activation requires Sales verification. This is a platform
fund-flow product; Ezkart's business-account KYB and a consumer DOKU e-wallet's
KYC must not automatically be imposed on each seller Sub-Account. API input
requirements also do not waive seller due-diligence duties in Ezkart's agreement.

Two exact questions remain before claiming sufficiency: (1) for Ezkart's actual
adult-seller beta and public buyer/storefront features, what proportionate
verification satisfies PDP Article 29 and PP 80 identity duties, and does PP 17's
child-access scope require additional age assurance? An Indonesian legal reviewer
must assess the actual service and resolve the final implementing text. (2) under
Ezkart's activated **Sub-Account V2 Collect & Route** agreement, which party must
verify each seller and bank beneficiary, by what evidence and before which
operation? Obtain the account-specific DOKU terms/confirmation. Neither question
justifies inventing a mandatory NIK/photo collection gate from the PSE declaration.

This check was read-only: no DOKU application, registration, identity collection,
provider transaction, external message or configuration change was made.
