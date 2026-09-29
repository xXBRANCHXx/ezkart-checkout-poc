# Landing-page contact routing

Contact assets (Open letter, Conversation card and Contact directory) default to
**Seller dashboard messages**. Melo's contact/help buttons and Soft Signal's
Order help button use the same native action when applying those templates.

Select the contact button, open **Click action**, choose **Email**, enter the
seller's address and apply the action to use an email application instead.
Choose **Seller dashboard messages** to switch back. The legacy button
Destination control also offers seller messages alongside Email.

Preview, published snapshots and exported HTML resolve the contact destination
through the first connected product and open Ezkart's buyer Messages page in a
new tab. The existing messaging API resolves the seller from the product and
requires buyer sign-in. Messages and replies use the seller dashboard's Messages
inbox. This works independently of whether the catalog storefront is enabled.
An empty draft does not open an unscoped inbox; connect a product to preview the
contact action. Existing email links remain as configured.

Published snapshots do not change automatically. Existing pages can choose the
new destination on their button, save and republish. Applying the updated
contact assets/templates affects new additions, not existing merchant content.
