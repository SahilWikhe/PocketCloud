import { useMemo, useRef, useState, type DragEvent } from "react";

import {
  maximumMvpUploadBytes,
  type DeploymentState,
  type DeploymentStatusV1,
} from "@pocketcloud/core";

import {
  CustomerApiError,
  PocketCloudClient,
  type PocketCloudClientLike,
  type ProgressUpdate,
} from "./lib/pocketcloud-client";

const progressSteps = [
  "Upload received",
  "Checking your project",
  "Fixing issues",
  "Preparing deployment",
  "Publishing",
  "Final check",
  "App ready",
] as const;

function stepForState(state: DeploymentState | undefined): number {
  switch (state) {
    case undefined:
    case "CREATED":
    case "UPLOADING":
    case "QUARANTINED":
      return 0;
    case "QUEUED":
    case "CLAIMED":
    case "SANDBOX_STARTING":
    case "ANALYZING":
      return 1;
    case "NORMALIZING":
      return 2;
    case "VALIDATING":
    case "READY_TO_DEPLOY":
      return 3;
    case "DEPLOYING":
      return 4;
    case "VERIFYING":
      return 5;
    case "READY":
      return 6;
    case "FAILED":
    case "CANCELLED":
    case "SUSPENDED":
      return -1;
  }
}

function appNameFromFile(file: File): string {
  return file.name.replace(/\.zip$/i, "").replace(/[-_]+/g, " ").trim() || "My website";
}

export interface AppProps {
  client?: PocketCloudClientLike;
}

export function App({ client }: AppProps) {
  const api = useMemo(() => client ?? new PocketCloudClient(), [client]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [appName, setAppName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ProgressUpdate>({ message: "Ready to upload" });
  const [result, setResult] = useState<DeploymentStatusV1 | null>(null);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);

  function selectFile(nextFile: File | undefined): void {
    if (!nextFile) {
      return;
    }
    setFile(nextFile);
    if (!appName) {
      setAppName(appNameFromFile(nextFile));
    }
    setResult(null);
    setError(null);
    setProgress({ message: "Ready to upload" });
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    selectFile(event.dataTransfer.files[0]);
  }

  async function startDeployment(): Promise<void> {
    if (!file || !appName.trim() || running) {
      return;
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError({ message: "Choose a ZIP file containing your static website.", retryable: false });
      return;
    }
    if (file.size > maximumMvpUploadBytes) {
      setError({ message: "Your ZIP must be 10 MB or smaller.", retryable: false });
      return;
    }

    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const deployment = await api.deploy(file, appName.trim(), setProgress);
      setResult(deployment);
      if (deployment.status !== "READY") {
        setError({
          message: deployment.error?.message ?? "This deployment did not finish successfully.",
          retryable: deployment.error?.retryable ?? false,
        });
      }
    } catch (caught) {
      const customerError = caught instanceof CustomerApiError ? caught : null;
      setError({
        message: customerError?.message ?? "PocketCloud could not finish this deployment.",
        retryable: customerError?.retryable ?? true,
      });
    } finally {
      setRunning(false);
    }
  }

  const activeStep = result?.status === "READY" ? 6 : stepForState(progress.deploymentState);

  return (
    <div className="page-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="PocketCloud home">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span>PocketCloud</span>
        </a>
        <span className="prototype-pill">Static-site prototype</span>
      </header>

      <main className="main-layout">
        <section className="intro" aria-labelledby="page-title">
          <p className="eyebrow">From project folder to public link</p>
          <h1 id="page-title">Share your website without learning the cloud.</h1>
          <p className="lede">
            Upload a small static-site ZIP. PocketCloud checks the project in isolation,
            prepares it for publishing, and gives you a link.
          </p>
          <div className="trust-row" aria-label="Product protections">
            <span>Private upload</span>
            <span>Isolated processing</span>
            <span>Original preserved</span>
          </div>
        </section>

        <section className="workspace-card" aria-label="Deploy a static website">
          <div className="card-heading">
            <div>
              <p className="step-label">New deployment</p>
              <h2>Upload your project</h2>
            </div>
            <span className="limit-label">ZIP · 10 MB max</span>
          </div>

          <div
            className={`drop-zone${dragging ? " is-dragging" : ""}${file ? " has-file" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept=".zip,application/zip"
              onChange={(event) => selectFile(event.target.files?.[0])}
              aria-label="Choose a ZIP file"
            />
            <span className="upload-icon" aria-hidden="true">↑</span>
            {file ? (
              <>
                <strong>{file.name}</strong>
                <span>{(file.size / 1024).toFixed(1)} KB selected</span>
              </>
            ) : (
              <>
                <strong>Drop your ZIP here</strong>
                <span>or choose it from your computer</span>
              </>
            )}
            <button className="secondary-button" type="button" onClick={() => inputRef.current?.click()}>
              {file ? "Choose another" : "Choose ZIP"}
            </button>
          </div>

          <label className="field-label">
            App name
            <input
              value={appName}
              onChange={(event) => setAppName(event.target.value)}
              maxLength={120}
              placeholder="My launch page"
              disabled={running}
            />
          </label>

          <button
            className="primary-button"
            type="button"
            disabled={!file || !appName.trim() || running}
            onClick={() => void startDeployment()}
          >
            {running ? "Publishing…" : "Publish website"}
          </button>

          {(running || result || error) && (
            <div className="progress-panel" aria-live="polite">
              <div className="progress-summary">
                <span className={`status-dot${error ? " error" : ""}`} aria-hidden="true" />
                <div>
                  <strong>{error ? "Needs attention" : progress.message}</strong>
                  {progress.uploadPercentage !== undefined && running && (
                    <span>{Math.round(progress.uploadPercentage)}% uploaded</span>
                  )}
                </div>
              </div>

              {!error && (
                <ol className="progress-list">
                  {progressSteps.map((step, index) => (
                    <li
                      key={step}
                      className={index < activeStep ? "complete" : index === activeStep ? "active" : ""}
                    >
                      <span aria-hidden="true">{index < activeStep ? "✓" : index + 1}</span>
                      {step}
                    </li>
                  ))}
                </ol>
              )}

              {error && (
                <div className="error-box">
                  <p>{error.message}</p>
                  <span>{error.retryable ? "You can try again." : "Check the ZIP and choose another file."}</span>
                </div>
              )}

              {result?.status === "READY" && result.publicUrl && (
                <div className="success-box">
                  <p>Your website is live.</p>
                  <a href={result.publicUrl} target="_blank" rel="noreferrer">Open your website ↗</a>
                  {result.changes.length > 0 && (
                    <ul aria-label="Changes PocketCloud made">
                      {result.changes.map((change) => <li key={change.changeId}>{change.summary}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        <p className="security-note">
          PocketCloud applies platform checks and isolation. It does not claim uploaded code is malware-free.
        </p>
      </main>
    </div>
  );
}
