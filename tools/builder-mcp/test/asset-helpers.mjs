// Use the same chooser a merchant sees, whether Assets started open or closed.
export async function openAssets(page) {
  if (!await page.locator('[data-sq-panel=add]').isVisible()) await page.locator('[data-sq-tab=add]').click();
}
export async function chooseBasic(page,type,option) {
  await openAssets(page);
  await page.locator('[data-sq-library-category=elements]').click();
  const tile=page.locator(`[data-sq-add-element=${type}]`);
  if(!await tile.isVisible())await page.locator('.sq-library-more > summary').click();
  await tile.click();
  const choices=page.locator('[data-sq-asset-choice]:visible');
  if(await choices.count()) await (option?page.locator(`[data-sq-asset-choice="${option}"]`):choices.first()).click();
}
