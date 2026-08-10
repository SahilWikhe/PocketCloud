import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { maximumMvpUploadBytes, type DeploymentStatusV1 } from "@pocketcloud/core";

import { App } from "./App";
import type { PocketCloudClientLike } from "./lib/pocketcloud-client";

const readyDeployment: DeploymentStatusV1 = {
  schemaVersion: 1,
  deploymentId: "deployment-1",
  appId: "app-1",
  versionId: "version-1",
  status: "READY",
  publicUrl: "https://demo.pocketcloudusercontent.example",
  error: null,
  events: [],
  changes: [
    {
      schemaVersion: 1,
      changeId: "change-1",
      source: "deterministic",
      ruleCode: "MOVE_WRAPPER",
      operation: "move",
      path: "index.html",
      previousPath: "website/index.html",
      summary: "Moved the website to the deployable root.",
      requiresCustomerAttention: false,
    },
  ],
};

function chooseFile(file: File): void {
  fireEvent.change(screen.getByLabelText("Choose a ZIP file"), {
    target: { files: [file] },
  });
}

describe("PocketCloud upload experience", () => {
  it("publishes a ZIP and shows the verified link and change summary", async () => {
    const deploy = vi.fn<PocketCloudClientLike["deploy"]>(async (_file, _name, progress) => {
      progress({ message: "Checking your project", deploymentState: "ANALYZING" });
      progress({ message: "App ready", deploymentState: "READY" });
      return readyDeployment;
    });
    render(<App client={{ deploy }} />);

    chooseFile(new File(["zip"], "launch-page.zip", { type: "application/zip" }));
    expect(screen.getByDisplayValue("launch page")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publish website" }));

    await waitFor(() => expect(deploy).toHaveBeenCalledOnce());
    expect(await screen.findByRole("link", { name: "Open your website ↗" })).toHaveAttribute(
      "href",
      readyDeployment.publicUrl,
    );
    expect(screen.getByText("Moved the website to the deployable root.")).toBeInTheDocument();
  });

  it("rejects an obviously oversized ZIP before calling the API", async () => {
    const deploy = vi.fn<PocketCloudClientLike["deploy"]>();
    render(<App client={{ deploy }} />);
    chooseFile(
      new File([new Uint8Array(maximumMvpUploadBytes + 1)], "large.zip", {
        type: "application/zip",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Publish website" }));

    expect(await screen.findByText("Your ZIP must be 10 MB or smaller.")).toBeInTheDocument();
    expect(deploy).not.toHaveBeenCalled();
  });

  it("shows customer-safe failure guidance", async () => {
    const failed: DeploymentStatusV1 = {
      ...readyDeployment,
      status: "FAILED",
      publicUrl: null,
      changes: [],
      error: {
        code: "ENTRYPOINT_MISSING",
        message: "PocketCloud could not find a supported index.html entry point.",
        guidance: "Add index.html at the ZIP root or inside one wrapper folder.",
        retryable: false,
      },
    };
    const deploy = vi.fn<PocketCloudClientLike["deploy"]>(async () => failed);
    render(<App client={{ deploy }} />);
    chooseFile(new File(["zip"], "broken.zip", { type: "application/zip" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish website" }));

    expect(
      await screen.findByText("PocketCloud could not find a supported index.html entry point."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Add index.html at the ZIP root or inside one wrapper folder."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Vercel|Sandbox|provider/i)).not.toBeInTheDocument();
  });
});
