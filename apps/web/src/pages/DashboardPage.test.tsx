import { render, screen } from "@testing-library/react";
import type { CustomerDashboardV1 } from "@pocketcloud/core";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { DashboardPage } from "./DashboardPage";

vi.mock("@clerk/react", () => ({
  useUser: () => ({
    user: {
      firstName: "Ada",
      primaryEmailAddress: { emailAddress: "ada@example.com" },
    },
  }),
  UserButton: () => <button type="button">Account menu</button>,
}));

const dashboard: CustomerDashboardV1 = {
  schemaVersion: 1,
  session: {
    schemaVersion: 1,
    user: { userId: "usr_1", primaryEmail: "ada@example.com", displayName: "Ada Owner" },
    workspace: {
      workspaceId: "wsp_1",
      name: "Ada's workspace",
      slug: "personal-ada",
      role: "OWNER",
      planCode: "FREE",
    },
  },
  apps: [
    {
      appId: "app_1",
      name: "Launch site",
      slug: "launch-site",
      status: "ACTIVE",
      activeVersionId: "ver_1",
      latestDeployment: {
        deploymentId: "dep_1",
        versionId: "ver_1",
        status: "READY",
        publicUrl: "https://launch-site.vercel.app",
        createdAt: "2026-08-12T06:00:00.000Z",
        updatedAt: "2026-08-12T06:01:00.000Z",
      },
      createdAt: "2026-08-12T05:59:00.000Z",
      updatedAt: "2026-08-12T06:01:00.000Z",
    },
  ],
  deployments: [
    {
      deploymentId: "dep_1",
      appId: "app_1",
      appName: "Launch site",
      versionId: "ver_1",
      status: "READY",
      publicUrl: "https://launch-site.vercel.app",
      errorMessage: null,
      createdAt: "2026-08-12T06:00:00.000Z",
      updatedAt: "2026-08-12T06:01:00.000Z",
    },
  ],
};

describe("customer dashboard", () => {
  it("shows the signed-in customer's projects and deployment history", async () => {
    const getDashboard = vi.fn(async () => dashboard);
    render(
      <MemoryRouter>
        <DashboardPage client={{ getDashboard }} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Welcome back, Ada." }))
      .toBeInTheDocument();
    expect(screen.getAllByText("Launch site")).toHaveLength(2);
    expect(screen.getAllByText("Live")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Open ↗" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Open ↗" })[0]).toHaveAttribute(
      "href", "https://launch-site.vercel.app",
    );
    expect(getDashboard).toHaveBeenCalledOnce();
  });
});
