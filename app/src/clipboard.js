/**
 * Copying text to the clipboard, and the button that does it.
 *
 * Lives outside main.js because more than one pane copies: the editor, the TriG
 * pane, the query text, and the results table, which is built in resultsView.js.
 */

export async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the execCommand fallback below
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(textarea);
  return ok;
}

export function wireCopyButton(button, getText) {
  button.addEventListener('click', async () => {
    const ok = await copyToClipboard(getText());
    const original = button.textContent;
    button.textContent = ok ? 'Copied!' : 'Copy failed';
    button.classList.toggle('copied', ok);
    button.classList.toggle('copy-failed', !ok);
    setTimeout(() => {
      button.textContent = original;
      button.classList.remove('copied', 'copy-failed');
    }, 1200);
  });
}
