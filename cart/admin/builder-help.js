/* Contextual, read-only help for the native inspector. */
(() => {
  const topics = {};
  const topic = (key, selector, title, description, steps, values, caption) => {
    topics[key] = { selector, title, description, steps, values, caption };
  };
  const prop = (key, title, description, steps, values, caption) =>
    topic(key, `[data-native-prop="${key}"]`, title, description, steps, values, caption);
  const state = (key, title, description, steps, values, caption) =>
    topic(key, `[data-state-setting="${key}"]`, title, description, steps, values, caption);
  const field = (key, title, description, steps, values, caption) =>
    topic(key, `[data-native-${key}]`, title, description, steps, values, caption);

  prop("position", "Position", "Choose whether an element stays in the page layout, sits inside a container, or stays on screen while visitors scroll.",
    ["For a badge on a product card, set the card’s Position to Relative.", "Select the badge and choose Absolute. Set Top and Right to 16px.", "Use Sticky with Top set to 0px for a bar that sticks while its container scrolls. Fixed stays in the browser window."],
    [["Card position", "Relative"], ["Badge position", "Absolute"], ["Top / Right", "16px"]], "The badge sits in the card’s top-right corner. Absolute positioning does not reserve space in the normal layout.");
  for (const [key, edge] of [["top", "top"], ["right", "right"], ["bottom", "bottom"], ["left", "left"]]) {
    prop(key, key[0].toUpperCase() + key.slice(1), `Set the distance from the ${edge} edge. This needs a Position such as Relative, Absolute, Fixed, or Sticky.`,
      ["To place something inside a card, set the card’s Position to Relative.", `Select the item, set Position to Absolute, then enter 24px in ${key[0].toUpperCase() + key.slice(1)}.`, "Use one value, such as 24px or 10%. With Relative, this offsets the item from its normal place; with Fixed, it usually measures from the browser window."],
      [["Position", "Absolute"], [key[0].toUpperCase() + key.slice(1), "24px"]], `The highlighted item sits 24 pixels from the card’s ${edge} edge. The other direction is set separately.`);
  }
  prop("zIndex", "Z index", "Control which overlapping element appears in front. A higher number is usually closer to the visitor.",
    ["Select the element that should appear in front and set Position to Relative or Absolute.", "Enter 2 in Z index; give the overlapping sibling 1.", "Compare elements in the same container. A child cannot escape its parent’s stacking group just by using a larger number."],
    [["Back card", "1"], ["Front badge", "2"]], "The badge with Z index 2 appears over the card with Z index 1.");
  prop("transform", "Transform", "Rotate, resize, or shift an element visually without moving the surrounding content.",
    ["Select a card or image.", "Enter rotate(-8deg) for a slight tilt, or scale(1.1) to make it 10% larger.", "Clear the field to remove your transform. Check nearby elements for overlap."],
    [["Transform", "rotate(-8deg)"]], "The same card is tilted by 8 degrees. Its original space in the layout stays the same.");
  prop("transformOrigin", "Transform origin", "Choose the pivot point used when an element rotates or scales.",
    ["Set Transform to rotate(-12deg).", "Enter left bottom in Transform origin to pivot around the bottom-left corner.", "Use center center to pivot around the middle instead."],
    [["Transform", "rotate(-12deg)"], ["Transform origin", "left bottom"]], "The dot marks the bottom-left pivot. Changing the pivot changes where the tilted card ends up.");
  prop("perspective", "Perspective", "Give a container’s 3D-transformed children a sense of depth. Smaller values create a stronger effect.",
    ["Select a container and enter 600px in Perspective.", "Select a child card and enter rotateY(35deg) in Transform.", "Compare the result. Perspective alone does not tilt anything; the child needs a 3D transform."],
    [["Container perspective", "600px"], ["Child transform", "rotateY(35deg)"]], "The card turns in 3D inside its container. Use a length such as 600px, not a percentage.");
  prop("isolation", "Isolation", "Keep a container’s layers in their own stacking group. This helps control overlapping designs.",
    ["Select the container whose children should stack together.", "Choose Isolate. Adjust the children’s Z index inside that group.", "Set the container’s own Position and Z index to place the entire group above or below a sibling."],
    [["Group isolation", "Isolate"], ["Child Z index", "99"], ["Sibling Z index", "2"]], "Even a child with Z index 99 stays inside its group. The sibling can still appear over the entire group.");
  prop("cursor", "Cursor", "Choose the mouse cursor visitors see when hovering over this element on a computer.",
    ["Select a clickable element and choose Pointer for a hand cursor.", "Add its behavior under Click action if it should open a link or perform an action.", "Use Match element behavior for the usual cursor. This setting has no visible cursor effect on touchscreens."],
    [["Cursor", "Pointer"], ["Click action", "Open link"]], "A hand cursor signals that an element can be clicked. Changing the cursor alone does not add an action.");
  prop("listStyleType", "List style type", "Choose bullets, numbers, or no marker for list items.",
    ["Use a list container with HTML element ul or ol, and child items with HTML element li.", "Select the list and choose Disc for bullets or Decimal for numbers.", "Leave enough left padding for the markers. Choosing a marker does not turn ordinary text into a list."],
    [["List HTML element", "ol"], ["Item HTML element", "li"], ["List style type", "Decimal"]], "Decimal creates a numbered list; Disc creates bullets; None removes the markers.");
  prop("pointerEvents", "Pointer events", "Choose whether this element receives mouse clicks and taps, or lets them pass through to something behind it.",
    ["Select a decorative overlay that sits over a real button.", "Choose None so clicks can reach the button beneath it.", "Use Yes for normal interaction. None does not reliably disable keyboard access; do not use it as a disabled-button setting."],
    [["Overlay pointer events", "None"], ["Button pointer events", "Yes"]], "The decorative overlay lets the click reach the Shop now button underneath.");

  state("initialState", "Starting version", "Choose the named appearance selected when this group first opens, such as all, delivery, or collection.",
    ["Select the container that owns the tabs or filters and enter a starting name, such as delivery.", "Give each button a Click action of Switch state. Use the matching name as its target and the container’s ID as its Interaction group ID.", "Create matching alternate versions for the content under Responsive layout & alternate versions. Connect them using Appearance follows group ID."],
    [["Starting version", "delivery"], ["Button action target", "delivery"]], "Delivery is the initial selection. The name must match the button’s target and the content’s alternate version.");
  state("stateMode", "Control style", "Tell the browser whether this group uses ordinary buttons, tabs, or filters. Tabs also support arrow-key navigation.",
    ["Select the container that owns the connected state-switching buttons.", "Choose Tabs for alternate panels, Filters for narrowing a collection, or Buttons for a general switch.", "Connect the buttons and content to the same group. Style their appearance separately; this choice does not create or redesign the controls."],
    [["Control style", "Tabs"], ["Starting version", "delivery"]], "Delivery and Collection form a tab group. Selecting a tab activates its connected version.");
  state("stateParam", "Remember choice in URL", "Add the selected version to the page link so a visitor can share that choice or reopen it later.",
    ["On a working tabs or filters container, enter a short link key such as view.", "Open Preview and choose a different tab. The page link can include ?view=collection.", "Use a different key for each independent group. Leave this field blank if the choice should not be stored in the link."],
    [["Remember choice in URL", "view"], ["Selected version", "collection"]], "A link ending in ?view=collection requests the Collection version. This field is the key name, not a yes/no setting.");
  state("stateScope", "Appearance follows group ID", "Make this element’s alternate appearance follow the selection of a containing group.",
    ["Find the controlling container’s ID; the Parent container list shows IDs after the dot beside each name.", "Enter that exact ID here on a child inside that container.", "Under Responsive layout & alternate versions, add a version matching the button target, then change its appearance. Return to Normal appearance when finished."],
    [["Group ID (example)", "delivery-tabs"], ["Appearance follows group ID", "delivery-tabs"], ["Alternate version", "collection"]], "The content follows its containing group’s Collection selection. Use your own container’s ID in place of delivery-tabs.");
  state("statePanel", "Tab panel version", "Identify which named tab this content belongs to, so assistive technology can connect the tab and its panel.",
    ["On the parent group, set Control style to Tabs and connect its buttons using Switch state actions.", "Select the content panel and enter the matching button target, such as collection.", "To show and hide panels, also connect Appearance follows group ID and set Display for each alternate version. This field alone does not hide content."],
    [["Control style", "Tabs"], ["Tab panel version", "collection"], ["Button target", "collection"]], "The Collection tab is associated with the Collection panel. Matching alternate versions control whether the panel is visible.");

  field("name", "Name", "Give this element a recognizable name in the editor. It does not change the words visitors see on the page.",
    ["Select the section or element.", "Enter a useful name, such as Shipping FAQ, then leave the field.", "Use that name to find it again in the editor. Edit visible wording in the Text panel."],
    [["Name", "Shipping FAQ"]], "Shipping FAQ identifies the section in the editor. The page heading still reads Common questions.");
  field("anchor", "Section anchor", "Give this section a short address that buttons and links can jump to on the same page.",
    ["Enter a unique name without spaces or #, such as bantuan.", "Select a button, choose Open link under Click action, and enter #bantuan as its destination. Click Apply action.", "Open Preview and click the button to check where it lands."],
    [["Section anchor", "bantuan"], ["Button destination", "#bantuan"]], "Clicking Help jumps to the FAQ section with the bantuan anchor.");
  field("tag", "HTML element", "Describe the element’s role to browsers and assistive technology. Choose the role that matches the content.",
    ["For a major page section, choose section. Use nav for navigation and footer for the page footer.", "Use div for a general layout group. Text elements offer choices such as paragraphs and headings.", "Check the page after changing the element. Some choices, such as lists and tables, also affect layout."],
    [["HTML element", "section"]], "The FAQ is marked as a page section. Its heading and content remain editable.");
  field("table-scope", "Table header for", "Tell screen readers whether a table header describes a column or a row. This appears for a th table cell.",
    ["Select a header cell and choose th as its HTML element.", "Choose Column when the header describes the cells below it, or Row when it describes cells beside it.", "Use clear labels such as Product and Price."],
    [["HTML element", "th"], ["Table header for", "Column"]], "Price is a column header for the amounts below it.");
  field("move-parent", "Parent container", "Choose the group that should contain this element. The move happens when you click Move into container.",
    ["Select the element you want to move.", "Choose its destination from Parent container. Each entry shows the name and ID.", "Click Move into container. Check its spacing because the new parent’s layout may affect it."],
    [["Parent container", "Product card · product-card"], ["Then click", "Move into container"]], "The price moves inside the Product card group with the product name and button.");
  field("move", "Move into container", "Move the selected element into the destination chosen in Parent container.",
    ["Choose a destination in Parent container.", "Click Move into container.", "Check the result on the canvas. Use Undo if you chose the wrong group."],
    [["Parent container", "Product card · product-card"], ["Action", "Move into container"]], "The price is now a child of Product card, so the card’s layout controls its placement.");
  field("earlier", "Move earlier", "Move this element one place earlier among the items in the same container.",
    ["Select the item you want to reorder.", "Click Move earlier once to move it before its previous sibling.", "In a vertical layout this usually moves it up. In a horizontal layout it usually moves left. Absolute positioning can keep it in the same visible place."],
    [["Selected item", "Shipping"], ["Action", "Move earlier"]], "Shipping moves before Returns in the container’s order.");
  field("later", "Move later", "Move this element one place later among the items in the same container.",
    ["Select the item you want to reorder.", "Click Move later once to move it after its next sibling.", "In a vertical layout this usually moves it down. In a horizontal layout it usually moves right. Absolute positioning can keep it in the same visible place."],
    [["Selected item", "Shipping"], ["Action", "Move later"]], "Shipping moves after Returns in the container’s order.");
  field("collapsed", "Initially hidden", "Start with this element hidden from visitors, then reveal it with a connected button.",
    ["Select the content and check Initially hidden (toggle target).", "On its button, choose Show / hide element under Click action. Enter the hidden element’s ID as the target and click Apply action.", "Test the button in Preview, or hold Alt while clicking it in the editor. The content stays editable on the canvas."],
    [["Initially hidden", "Checked"], ["Button action", "Show / hide element"]], "The size guide starts hidden. Clicking View size guide reveals it.");
  field("open", "Accordion initially open", "Choose whether an accordion’s answer is expanded when visitors first open the page.",
    ["Select an Accordion element.", "Check Accordion initially open to show its answer immediately, or uncheck it to start closed.", "Open Preview and click the question to check that it opens and closes. This setting applies to accordions."],
    [["Accordion initially open", "Checked"]], "The shipping answer is visible on page load. Visitors can still collapse it.");
  field("alt", "Accessible label", "Give an image or control a useful text description for people using assistive technology.",
    ["For an image, describe what matters, such as Oak desk tray with three compartments.", "For an icon-only control, describe its action, such as Open shopping cart.", "Keep the description concise. If a button already has visible text, use a label that includes that wording."],
    [["Image description", "Oak desk tray with three compartments"], ["Icon button label", "Open shopping cart"]], "A screen reader can announce the tray’s description or the cart button’s purpose. The label does not add a visible caption.");

  const scriptUrl = typeof document === "undefined" ? "" : document.currentScript?.src;
  function attach(panel) {
    if (panel.dataset.settingHelpReady) return;
    panel.dataset.settingHelpReady = "true";
    let dialog, opener;
    function createDialog() {
      dialog = document.createElement("dialog");
      dialog.className = "sq-setting-help-dialog";
      dialog.id = "sq-setting-help-dialog";
      dialog.setAttribute("aria-labelledby", "sq-setting-help-title");
      dialog.setAttribute("aria-describedby", "sq-setting-help-description");
      dialog.innerHTML = `<header><h2 id="sq-setting-help-title"></h2><button type="button" data-setting-help-close aria-label="Close setting help" autofocus>×</button></header><div class="sq-setting-help-body"><p id="sq-setting-help-description"></p><h3>How to use it</h3><ol data-setting-help-steps></ol><button type="button" class="sq-setting-help-example-toggle" aria-expanded="false" aria-controls="sq-setting-help-example">See example <span aria-hidden="true">↗</span></button><section id="sq-setting-help-example" hidden><h3>Example</h3><figure><img width="960" height="600" alt=""><figcaption></figcaption><a class="sq-setting-help-full-size" target="_blank" rel="noopener">Open full-size picture ↗</a></figure><dl></dl><p class="sq-setting-help-note">Example only. Your page settings stay as they are.</p></section></div>`;
      document.body.append(dialog);
      dialog.querySelector("[data-setting-help-close]").addEventListener("click", () => dialog.close());
      // Keep editor Delete, arrow-key and Escape shortcuts out of this dialog.
      dialog.addEventListener("keydown", event => event.stopPropagation());
      dialog.addEventListener("click", event => {
        if (event.target !== dialog) return;
        const box = dialog.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
      });
      dialog.addEventListener("close", () => {
        opener?.setAttribute("aria-expanded", "false");
        if (opener?.isConnected) opener.focus({ preventScroll: true });
      });
      dialog.querySelector(".sq-setting-help-example-toggle").addEventListener("click", event => {
        const example = dialog.querySelector("#sq-setting-help-example");
        example.hidden = !example.hidden;
        dialog.classList.toggle("sq-setting-help-expanded", !example.hidden);
        event.currentTarget.setAttribute("aria-expanded", String(!example.hidden));
        event.currentTarget.textContent = example.hidden ? "See example ↗" : "Hide example";
        if (!example.hidden) {
          const img = example.querySelector("img");
          img.src = img.dataset.src;
          example.scrollIntoView({ block: "start" });
        } else dialog.scrollTop = 0;
      });
    }
    function show(key, button) {
      if (!dialog) createDialog();
      const entry = topics[key];
      opener = button;
      dialog.querySelector("h2").textContent = entry.title;
      dialog.querySelector("#sq-setting-help-description").textContent = entry.description;
      dialog.querySelector("ol").replaceChildren(...entry.steps.map(step => {
        const item = document.createElement("li");
        item.textContent = step;
        return item;
      }));
      const example = dialog.querySelector("#sq-setting-help-example");
      example.hidden = true;
      const img = example.querySelector("img");
      img.removeAttribute("src");
      img.dataset.src = new URL(`assets/builder-help/${key}.png`, scriptUrl || location.href).href;
      img.alt = entry.caption;
      example.querySelector(".sq-setting-help-full-size").href = img.dataset.src;
      example.querySelector("figcaption").textContent = entry.caption;
      example.querySelector("dl").replaceChildren(...entry.values.flatMap(([label, value]) => {
        const term = document.createElement("dt"), detail = document.createElement("dd");
        term.textContent = label;
        detail.textContent = value;
        return [term, detail];
      }));
      dialog.classList.remove("sq-setting-help-expanded");
      const toggle = dialog.querySelector(".sq-setting-help-example-toggle");
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "See example ↗";
      button.setAttribute("aria-expanded", "true");
      dialog.showModal();
      dialog.scrollTop = 0;
    }
    createDialog();
    for (const [key, entry] of Object.entries(topics)) {
      const input = panel.querySelector(entry.selector);
      if (!input) continue;
      const label = input.closest("label"), target = label || input;
      const wrap = document.createElement("div");
      wrap.className = label ? "sq-setting-with-help" : "sq-setting-action-help";
      target.before(wrap);
      wrap.append(target);
      if (label) {
        for (const node of [...label.childNodes]) {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
          const text = document.createElement("span");
          text.className = "sq-setting-label-text";
          node.replaceWith(text);
          text.append(node);
        }
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sq-setting-info";
      button.dataset.settingHelp = key;
      button.setAttribute("aria-label", `Help with ${entry.title}`);
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-controls", "sq-setting-help-dialog");
      button.setAttribute("aria-expanded", "false");
      button.innerHTML = '<span aria-hidden="true">i</span>';
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        show(key, button);
      });
      wrap.append(button);
    }
  }
  globalThis.EzkartBuilderHelp = { topics, attach };
})();
