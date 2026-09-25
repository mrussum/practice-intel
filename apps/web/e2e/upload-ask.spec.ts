import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const fixture = (name: string) => fileURLToPath(new URL(`../../../evals/fixtures/${name}`, import.meta.url));

test("upload documents, ask a gap question, open a citation's evidence", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Demo mode")).toBeVisible();

  await page.getByTestId("upload-resume").setInputFiles(fixture("resume-jordan-ellis.md"));
  await expect(page.getByText("Jordan Ellis", { exact: true })).toBeVisible();

  await page
    .getByTestId("upload-job")
    .setInputFiles([fixture("job-1-ledgerline-backend.md"), fixture("job-2-northwind-platform.md")]);
  await expect(page.getByText("Platform Engineer", { exact: true })).toBeVisible();
  await expect(page.getByText("Job #2", { exact: true })).toBeVisible();

  await page.getByLabel("Ask a question").fill("What skills am I missing for Job #2?");
  await page.getByRole("button", { name: "Send" }).click();

  const answer = page.getByRole("article", { name: "Assistant answer" });
  await expect(answer.getByText("Skill gaps")).toBeVisible();
  await expect(answer).toContainText("Kubernetes");

  const citation = answer.getByRole("button", { name: /^Citation 1: Job #2/ }).first();
  await citation.click();

  const evidence = page.getByRole("region", { name: "Evidence" });
  await expect(evidence.getByText("job-2-northwind-platform.md")).toBeVisible();
  const highlighted = evidence.getByTestId("highlighted-chunk");
  await expect(highlighted).toBeVisible();
  await expect(highlighted).toContainText("Kubernetes");
});
