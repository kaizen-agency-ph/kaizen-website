// ============================================================
// Floating "Help & feedback" widget (bottom-left).
// Self-contained: include with <script src="js/support.js"></script>.
// ============================================================
(function(){
  if (document.getElementById("kbt-support")) return;

  var wrap = document.createElement("div");
  wrap.id = "kbt-support";
  wrap.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:70;font-family:'Plus Jakarta Sans',system-ui,sans-serif;display:flex;flex-direction:column;align-items:flex-start;gap:10px;";

  var panel = document.createElement("div");
  panel.style.cssText = "display:none;position:relative;background:#fff;border:2px solid #F0E2D6;border-radius:16px;box-shadow:0 12px 34px rgba(108,99,255,.20);padding:18px 16px 15px;width:290px;max-width:calc(100vw - 32px);color:#2A2440;font-size:13px;line-height:1.5;";
  panel.innerHTML =
    "<button id='kbt-support-x' aria-label='Close' style='position:absolute;top:8px;right:11px;border:none;background:none;font-size:17px;line-height:1;color:#8A7F9C;cursor:pointer;padding:0'>×</button>"
    + "<div style=\"font-weight:700;margin-bottom:4px;color:#6C63FF;font-family:'Bricolage Grotesque',sans-serif;font-size:15px\">Questions, bugs or ideas?</div>"
    + "<div style='margin-bottom:13px;color:#8A7F9C;font-weight:600'>Found a bug, have a question, or want a new feature? Reach out — we'd love to hear from you.</div>"
    + "<a href='https://www.facebook.com/people/Kaizen-Agency/61558492156597/' target='_blank' rel='noopener' style='display:block;text-align:center;text-decoration:none;background:#6C63FF;color:#fff;padding:11px;border-radius:11px;font-weight:700;margin-bottom:8px'>Message us on Facebook</a>"
    + "<a href='mailto:benlot.vincentcarl@gmail.com' style='display:block;text-align:center;text-decoration:none;background:#fff;color:#6C63FF;border:2px solid #F0E2D6;padding:11px;border-radius:11px;font-weight:700'>Email us</a>";

  var toggle = document.createElement("button");
  toggle.type = "button";
  toggle.style.cssText = "cursor:pointer;background:#fff;color:#6C63FF;border:2px solid #F0E2D6;box-shadow:0 6px 18px rgba(108,99,255,.18);border-radius:999px;padding:11px 17px;font-family:inherit;font-size:13px;font-weight:700;display:flex;align-items:center;gap:7px;";
  toggle.innerHTML = "<span>💬</span><span>Help &amp; feedback</span>";

  wrap.appendChild(panel);
  wrap.appendChild(toggle);
  document.body.appendChild(wrap);

  toggle.addEventListener("click", function(){ panel.style.display = (panel.style.display === "none" ? "block" : "none"); });
  panel.querySelector("#kbt-support-x").addEventListener("click", function(){ panel.style.display = "none"; });
})();
