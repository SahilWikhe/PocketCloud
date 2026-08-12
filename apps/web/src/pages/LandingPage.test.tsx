import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { LandingPage } from "./LandingPage";

describe("PocketCloud landing page", () => {
  it("explains the product and sends visitors to account setup", () => {
    render(
      <MemoryRouter>
        <LandingPage authConfigured={false} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Turn a project folder into a live website." }))
      .toBeInTheDocument();
    expect(screen.getByText("Upload")).toBeInTheDocument();
    expect(screen.getByText("Check and repair")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Publish your first site" }))
      .toHaveAttribute("href", "/setup-required");
  });
});
