import { expect, test } from '../lib/fixtures/screenshot';
import { postBackendGraphQL } from '../lib/requests/post-backend-graphql';

// Tim Apple, the workspace member the e2e user signs in as.
const TIM_WORKSPACE_MEMBER_ID = '20202020-0687-4c41-b707-ed1bfca972a7';

test('Task stays in its group after adding a relation', async ({ page }) => {
  const title = `Grouped task ${Date.now()}`;

  // Open the "Assigned to Me" table first, so the reload below lands on it
  // directly. The view picker reads "<current view> · <record count>".
  await page.goto('/objects/tasks');
  await page.getByRole('button', { name: / · [\d,]+$/ }).first().click();
  await page.getByText('Assigned to Me', { exact: true }).click();
  await expect(page).toHaveURL(/viewId=/);
  await expect(
    page.getByRole('button', { name: /^Assigned to Me · / }),
  ).toBeVisible();

  const created = await postBackendGraphQL<{ createTask: { id: string } }>({
    page,
    data: {
      query: `mutation CreateTask($input: TaskCreateInput!) {
        createTask(data: $input) { id }
      }`,
      variables: {
        input: { title, status: 'TODO', assigneeId: TIM_WORKSPACE_MEMBER_ID },
      },
    },
  });
  expect(created.body.errors).toBeUndefined();
  const taskId = created.body.data?.createTask.id;
  expect(taskId).toBeTruthy();

  await page.reload();
  await expect(
    page.getByRole('button', { name: /^Assigned to Me · / }),
  ).toBeVisible();

  const taskCells = page.locator(`[data-record-table-record-id="${taskId}"]`);
  await expect(page.getByText(title, { exact: true })).toBeVisible();

  // The Relations cell is the one in the same column as the "Relations" header.
  const header = await page
    .getByText('Relations', { exact: true })
    .first()
    .boundingBox();
  expect(header).not.toBeNull();
  let relationsCell = taskCells.first();
  for (const cell of await taskCells.all()) {
    const box = await cell.boundingBox();
    if (box && header && header.x + 4 >= box.x && header.x + 4 < box.x + box.width) {
      relationsCell = cell;
      break;
    }
  }

  await relationsCell.click();
  await page.keyboard.type('Microsoft');

  // Watch every frame: the task must never leave the table while the relation is saved.
  await page.evaluate((taskTitle) => {
    const w = window as unknown as { taskMissing: boolean };
    w.taskMissing = false;
    const check = () => {
      if (!document.body.innerText.includes(taskTitle)) w.taskMissing = true;
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }, title);

  const relationSaved = page.waitForResponse(
    (response) =>
      response.url().includes('/graphql') &&
      /createTaskTargets/i.test(response.request().postData() ?? ''),
  );
  await page.getByRole('option', { name: /Microsoft/ }).first().click();
  await relationSaved;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(3000);

  const taskMissing = await page.evaluate(
    () => (window as unknown as { taskMissing: boolean }).taskMissing,
  );
  expect(taskMissing, 'the task disappeared from the table').toBe(false);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await expect(relationsCell).toContainText('Microsoft');
});
