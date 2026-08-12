import { Show } from "@clerk/react";
import { Link } from "react-router-dom";

function Logo() {
  return (
    <Link className="brand" to="/" aria-label="PocketCloud home">
      <span className="brand-mark" aria-hidden="true">P</span>
      <span>PocketCloud</span>
    </Link>
  );
}

function AuthenticatedActions() {
  return (
    <>
      <Show when="signed-out">
        <Link className="nav-link" to="/sign-in">Sign in</Link>
        <Link className="compact-cta" to="/sign-up">Start free</Link>
      </Show>
      <Show when="signed-in">
        <Link className="compact-cta" to="/dashboard">Open dashboard</Link>
      </Show>
    </>
  );
}

export interface LandingPageProps {
  authConfigured: boolean;
}

export function LandingPage({ authConfigured }: LandingPageProps) {
  return (
    <div className="marketing-page">
      <header className="marketing-header">
        <Logo />
        <nav className="marketing-nav" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#pricing">Pricing</a>
          {authConfigured ? <AuthenticatedActions /> : <span className="setup-chip">Private preview</span>}
        </nav>
      </header>

      <main>
        <section className="hero-section">
          <div className="hero-copy">
            <p className="eyebrow">The cloud for small software</p>
            <h1>Turn a project folder into a live website.</h1>
            <p className="hero-lede">
              Upload your ZIP. PocketCloud checks it, fixes common setup problems, publishes it,
              and gives you a link—without asking you to learn cloud infrastructure.
            </p>
            <div className="hero-actions">
              <Link className="hero-primary" to={authConfigured ? "/sign-up" : "/setup-required"}>
                Publish your first site
              </Link>
              <a className="hero-secondary" href="#how-it-works">See how it works</a>
            </div>
            <p className="hero-note">Start free · Static websites today · Full projects next</p>
          </div>

          <div className="product-preview" aria-label="PocketCloud product preview">
            <div className="preview-window-bar"><span /><span /><span /></div>
            <div className="preview-content">
              <div className="preview-upload">
                <span className="preview-icon">↑</span>
                <strong>launch-site.zip</strong>
                <small>Upload complete</small>
              </div>
              <ol className="preview-steps">
                <li className="done"><span>✓</span>Checked project</li>
                <li className="done"><span>✓</span>Fixed structure</li>
                <li className="done"><span>✓</span>Published safely</li>
              </ol>
              <div className="preview-live">
                <div><span className="live-dot" />Website live</div>
                <strong>launch-site.vercel.app ↗</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="proof-strip" aria-label="Product promises">
          <span>Private uploads</span><span>Isolated checks</span><span>Clear repair history</span><span>Vercel hosting</span>
        </section>

        <section className="story-section" id="how-it-works">
          <div className="section-heading">
            <p className="eyebrow">A shorter path to launch</p>
            <h2>Your software should not need an infrastructure team.</h2>
            <p>PocketCloud handles the technical handoffs between your files and a public website.</p>
          </div>
          <div className="story-grid">
            <article><span>01</span><h3>Upload</h3><p>Choose a ZIP from your computer and give the project a name.</p></article>
            <article><span>02</span><h3>Check and repair</h3><p>We inspect the structure and make safe, explainable setup fixes.</p></article>
            <article><span>03</span><h3>Publish</h3><p>We prepare the website and publish it through Vercel.</p></article>
            <article><span>04</span><h3>Manage</h3><p>See every project, deployment, status, and live link in one place.</p></article>
          </div>
        </section>

        <section className="pricing-section" id="pricing">
          <div className="section-heading">
            <p className="eyebrow">Simple from day one</p>
            <h2>Start small. Pay when your projects grow.</h2>
            <p>Billing is coming next. Early accounts begin on the free plan.</p>
          </div>
          <div className="pricing-grid">
            <article><p>Free</p><h3>$0</h3><span>For trying PocketCloud</span><ul><li>Static website uploads</li><li>Deployment history</li><li>PocketCloud checks</li></ul></article>
            <article className="featured-plan"><p>Launch</p><h3>Coming soon</h3><span>For real customer projects</span><ul><li>More projects and usage</li><li>Custom domains</li><li>Email notifications</li></ul></article>
            <article><p>Business</p><h3>Coming later</h3><span>For teams and larger workloads</span><ul><li>Team workspaces</li><li>Spend controls</li><li>Priority support</li></ul></article>
          </div>
        </section>

        <section className="final-cta">
          <p className="eyebrow">Keep the momentum</p>
          <h2>Your project is ready to leave your laptop.</h2>
          <Link className="hero-primary" to={authConfigured ? "/sign-up" : "/setup-required"}>Create your account</Link>
        </section>
      </main>

      <footer className="marketing-footer">
        <Logo />
        <p>Small software deserves a simple cloud.</p>
        <span>© {new Date().getFullYear()} PocketCloud</span>
      </footer>
    </div>
  );
}
