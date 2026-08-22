/** Turns a markup string into nodes and puts them in the document.
 *
 * The page used to be one 180-line ui.html holding the header, the board, the
 * symbol picker and the settings sheet together, and nothing said which part
 * belonged to which module. Each of those now sits beside the code that wires
 * it, and index.html is the shell they mount into.
 *
 * innerHTML on a template element rather than document.write or a pile of
 * createElement calls: the markup here is static structure with no values
 * interpolated into it - every word on screen arrives later from the text
 * table, through applyTexts() - so there is nothing for a value to escape out
 * of, and structure written as markup stays readable as markup.
 */
export function mount(where: HTMLElement, markup: string): void {
  const template = document.createElement("template");
  template.innerHTML = markup.trim();
  where.appendChild(template.content);
}
