# Storing seller age is not a promise of full ID verification

The owner clarified on 28 September 2026 that Ezkart's government declaration
said it would **store a seller's age**, not verify their identity. The earlier
implementation treated the owner's tentative “I guess we need ID-checking” as
a settled requirement and introduced an empty identity-evidence gate. That was
an overreach. Migration 0071 was still unapplied when the owner corrected it.

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
the PSE age-storage statement. Correct the premature mandatory identity gate
before deploying migration 0071. Existing payment-provider, beneficiary, financial
execution and public-release holds remain separate and unchanged.

Jev/OpenRouter remains scoped to reports and page flags. Creating its API key
does not approve identity processing, external model calls or automatic page
termination.
