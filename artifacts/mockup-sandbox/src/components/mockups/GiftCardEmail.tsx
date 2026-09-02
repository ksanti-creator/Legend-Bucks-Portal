export default function GiftCardEmail() {
  return (
    <main style={{ minHeight: "100vh", margin: 0, padding: "40px 16px", background: "#f5f5f5", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
      <div style={{ width: 560, maxWidth: "100%", margin: "0 auto" }}>
        <p style={{ margin: "0 0 12px", color: "#777", fontSize: 12 }}>Recipient email preview · Sample values only</p>
        <section style={{ background: "#fff", borderRadius: 8, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,.08)" }}>
          <header style={{ background: "linear-gradient(135deg,#00afed 0%,#0090cc 100%)", padding: "36px 40px 28px" }}>
            <p style={{ margin: 0, color: "#fff", fontSize: 11, fontWeight: 700, letterSpacing: 3, opacity: .8 }}>LEGEND BOATS</p>
            <h1 style={{ margin: "8px 0 0", color: "#fff", fontSize: 28, letterSpacing: "-.5px" }}>Legend Bucks</h1>
          </header>
          <div style={{ padding: "40px 40px 32px", color: "#4f4f51" }}>
            <p style={{ margin: "0 0 16px", fontSize: 16 }}>Hi Taylor,</p>
            <p style={{ margin: "0 0 24px", fontSize: 16 }}>You received a <strong>$50.00 CAD</strong> Legend Bucks Gift Card.</p>
            <p style={{ margin: "0 0 8px", color: "#888", fontSize: 13 }}>A personal message:</p>
            <p style={{ margin: "0 0 24px", padding: "14px 18px", background: "#f5f5f5", borderLeft: "4px solid #00afed", borderRadius: 6, fontStyle: "italic" }}>“Thank you for everything you do. Enjoy!”</p>
            <div style={{ padding: 22, background: "#f5f5f5", borderRadius: 8, textAlign: "center", marginBottom: 24 }}>
              <p style={{ margin: "0 0 12px", font: "700 20px monospace", letterSpacing: 2, color: "#222" }}>LBGC-7KMR-W2NH-9PXT-C4JF-H8QZ-M3VD-R6YA</p>
              <svg width="240" height="240" viewBox="0 0 120 120" aria-label="Sample gift card QR code" style={{ display: "block", margin: "auto", background: "#fff" }}>
                <rect width="120" height="120" fill="#fff" />
                <g fill="#111">
                  <path d="M6 6h32v32H6zm6 6v20h20V12zm5 5h10v10H17zM82 6h32v32H82zm6 6v20h20V12zm5 5h10v10H93zM6 82h32v32H6zm6 6v20h20V88zm5 5h10v10H17z" />
                  <path d="M46 6h8v8h-8zm16 0h8v16h-8zm-16 16h16v8H46zm24 8h8v16h-8zM46 38h8v8h-8zm16 8h16v8H62zM6 46h8v16H6zm16 0h16v8H22zm8 16h16v8H30zM14 70h16v8H14zm32-16h8v24h-8zm16 8h8v8h-8zm16-16h8v24h-8zm8 8h16v8H86zm16-8h8v24h-8zM46 86h8v28h-8zm8-8h16v8H54zm8 16h8v20h-8zm8-8h16v8H70zm8 16h8v12h-8zm16-24h8v16h-8zm8 24h12v12h-12z" />
                </g>
              </svg>
              <p style={{ margin: "12px 0 0", color: "#888", fontSize: 12 }}>Card reference: LBGC-••••-••••-••••-••••-••••-••••-R6YA</p>
            </div>
            <p style={{ margin: "0 0 12px", fontSize: 15 }}><strong>Present this code at a Legend Boats store to apply it toward your purchase.</strong></p>
            <p style={{ margin: 0, color: "#888", fontSize: 13 }}>This card cannot be exchanged for cash.</p>
          </div>
          <footer style={{ background: "#4f4f51", padding: "20px 40px" }}>
            <p style={{ margin: 0, color: "#fff", fontSize: 12, opacity: .6 }}>© 2026 Legend Boats Inc. — Internal use only.</p>
          </footer>
        </section>
      </div>
    </main>
  );
}