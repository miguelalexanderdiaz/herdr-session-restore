// The Copy buttons next to the install commands. Nothing is loaded, sent or stored; the page reads the same without it.
// A button (button[data-copy="<id>"]) is hidden in the HTML and shown here, so without this script there is no
// button that does nothing. It copies the text of the element with that id.
(() => {
  "use strict";
  for (const button of document.querySelectorAll("button[data-copy]")) {
    const source = document.getElementById(button.dataset.copy);
    if (!source || !navigator.clipboard) continue;
    const label = button.textContent;
    let timer = 0;
    button.hidden = false;
    button.addEventListener("click", () => {
      navigator.clipboard.writeText(source.textContent.trim()).then(() => {
        button.textContent = "Copied";
        clearTimeout(timer);
        timer = setTimeout(() => { button.textContent = label; }, 2000);
      }, () => {
        // No clipboard access (an insecure page, a denied permission): select the line so it can be copied by hand.
        const range = document.createRange();
        range.selectNodeContents(source);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });
    });
  }
})();
