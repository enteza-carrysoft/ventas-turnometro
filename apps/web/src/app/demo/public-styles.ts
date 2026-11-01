// Estilos de las páginas públicas: un bloque <style nonce> (la CSP no admite hojas en línea sin nonce).
export const PUBLIC_CSS = `
.pub{max-width:40rem;margin:0 auto;padding:2rem 1rem 4rem;line-height:1.5}
.pub h1{font-size:1.75rem;margin:0 0 .5rem}
.pub .lead{color:#444;margin:0 0 1.5rem}
.pub ul.facts{margin:0 0 1.5rem;padding-left:1.25rem}
.pub form{display:grid;gap:1rem}
.pub label.field{display:grid;gap:.25rem;font-weight:600}
.pub input[type=text],.pub input[type=email],.pub input[type=tel]{font:inherit;padding:.6rem .7rem;border:1px solid #9aa3ad;border-radius:.4rem}
.pub fieldset{border:1px solid #cfd4da;border-radius:.5rem;padding:1rem;display:grid;gap:.75rem}
.pub fieldset legend{font-weight:600;padding:0 .4rem}
.pub .box{display:grid;grid-template-columns:auto 1fr;gap:.6rem;align-items:start;font-weight:400}
.pub .err{color:#b00020;font-size:.9rem;font-weight:400}
.pub .info{font-size:.85rem;color:#444}
.pub .draft{background:#fff3cd;border:1px solid #e0b100;padding:.6rem .8rem;border-radius:.4rem;font-size:.9rem}
.pub button{font:inherit;font-weight:600;padding:.75rem 1.25rem;border:0;border-radius:.4rem;background:#0b5fff;color:#fff;cursor:pointer}
.pub button:disabled{opacity:.6;cursor:wait}
.pub .trap{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
.pub .ok{background:#e7f6ea;border:1px solid #2e7d32;padding:1rem;border-radius:.5rem}
`;
