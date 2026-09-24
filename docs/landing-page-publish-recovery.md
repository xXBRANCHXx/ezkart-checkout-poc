# Landing-page publication reliability — 24 September 2026

The merchant's Image Stack publication returned HTTP 503 after 16.8 seconds:
the Worker could not finish reading the existing project from R2. A subsequent
publication of the same page succeeded in 4.4 seconds. This establishes an
intermittent storage-read failure; it does not identify an underlying R2 outage.

A complete publication now checks the existing object's metadata instead of
downloading its previous artwork and HTML. The request already supplies every
editable field and the replacement publication. The original creation date is
preserved. Legacy objects without that metadata and partial draft updates still
read the original document, so omitted fields and previously published HTML are
retained. Publication still validates current seller-owned products and stock.

Full document reads have bounded read-only retries and cancel stalled bodies.
Preview writes validate the source version from metadata. Derived summary writes
run after the durable project write without delaying its response.

Each save carries a random identifier stored atomically in the project's R2
metadata. If its response is lost or times out, the editor checks that exact
identifier through an authenticated confirmation endpoint. It does not repeat
the write or accept an older publication as proof of success. The PHP proxy
permits that endpoint and logs transport timing without recording credentials
or page contents. The editor retains its edits when confirmation fails.

Delivery is limited to `agent/ezkart-workbench`, `test.ezkart.id`, and the test
Worker. Worker version: `9513ca9d-70e6-4e6c-ab7e-178f609f5efb`.

Verification:

- All 19 Worker tests passed, including complete publication with project-body
  reads disabled, legacy creation dates, partial draft preservation, seller
  ownership, stock, metadata-only confirmation, and stalled read cancellation.
- The full builder run passed 128 of 129 cases. The remaining grid drag case
  received a null bounding box during the combined run and passed when rerun
  alone without code changes. The run included the required blank editor,
  section actions, grid, Image Stack, save/reopen, and publication coverage.
- Publication browser tests passed for failed uploads, lost responses, exact
  save-ID recovery, rejection of older confirmations, and safe-close behavior.
  Progress and failure screenshots were visually checked at desktop and 320px.
- The PHP hosting/proxy browser test, PHP lint, JavaScript syntax, Worker test
  deployment build, health check, and diff checks passed.
- The merchant's successful publication was checked at its public test URL;
  all four artwork images loaded and the product controls rendered. That
  initial success preceded this follow-up deployment.
