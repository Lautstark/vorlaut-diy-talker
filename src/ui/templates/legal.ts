/* What the footer opens: about, the Impressum, and the privacy notice.
 *
 * One dialog with three bodies rather than three dialogs. They are the same
 * piece of furniture - a heading, a cross, one scrolling column of prose - and
 * the only thing that differs is which paragraphs are in it. The heading is
 * what gives the dialog its accessible name, so a reader that announces it
 * says "Impressum" while the Impressum is showing; that is also what the
 * end-to-end check looks the dialog up by.
 *
 * Every word here is an empty element with an id. None of the prose is in this
 * file, because all of it exists twice - see boot_data.ts - and because
 * markup assembled around a translated string is markup that has to be trusted
 * not to carry any. The two addresses that are not prose (the repository, the
 * mail) come through texts.ts's guarded setters for the same reason the Azure
 * link does: an href is the one thing on this page that is not inert.
 */
import { mount } from "./mount.js";

export const markup = `
<dialog id="legal" class="sheet legal" aria-labelledby="legalHeading">
  <div class="head">
    <strong id="legalHeading"></strong>
    <button id="legalClose" class="btn quiet icon closeX" type="button">&times;</button>
  </div>
  <div class="body">

    <section id="aboutPage" hidden>
      <p class="lead" id="aboutLead"></p>
      <h3 id="aboutLeavesHead"></h3>
      <p id="aboutLeaves"></p>
      <h3 id="aboutSymbolsHead"></h3>
      <p id="aboutSymbols"></p>
      <h3 id="aboutSourceHead"></h3>
      <p id="aboutSource"></p>
      <p class="legal__links">
        <a id="aboutRepo" target="_blank" rel="noreferrer noopener"></a>
        <a id="aboutMitreden" target="_blank" rel="noreferrer noopener"></a>
        <a id="aboutBildhaft" target="_blank" rel="noreferrer noopener"></a>
      </p>
    </section>

    <section id="impressumPage" hidden>
      <h3 id="impAngabenHead"></h3>
      <!-- Name, street, town and country as one value with newlines in it,
           and .address is what lets them stand as the four lines a postal
           address is. Four keys would let a translation lose one. -->
      <p class="address" id="impAddress"></p>
      <h3 id="impContactHead"></h3>
      <p id="impContactLead"></p>
      <p class="legal__links">
        <a id="impMail"></a>
        <a id="impIssues" target="_blank" rel="noreferrer noopener"></a>
      </p>
      <h3 id="impResponsibleHead"></h3>
      <p id="impResponsible"></p>
      <h3 id="impSymbolsHead"></h3>
      <p id="impSymbols"></p>
      <h3 id="impLinksHead"></h3>
      <p id="impLinks"></p>
      <h3 id="impDisputeHead"></h3>
      <p id="impDispute"></p>
    </section>

    <section id="privacyPage" hidden>
      <p class="lead" id="dsgLead"></p>
      <h3 id="dsgControllerHead"></h3>
      <p class="address" id="dsgController"></p>
      <p class="legal__links"><a id="dsgMail"></a></p>
      <h3 id="dsgHostingHead"></h3>
      <p id="dsgHosting"></p>
      <h3 id="dsgArasaacHead"></h3>
      <p id="dsgArasaac"></p>
      <h3 id="dsgCdnHead"></h3>
      <p id="dsgCdn"></p>
      <h3 id="dsgVoicesHead"></h3>
      <p id="dsgVoices"></p>
      <!-- Azure is the one that has to be read before it is switched on: it
           is the only path on which what somebody typed leaves the browser at
           all, rather than a lookup or a download. -->
      <h3 id="dsgAzureHead"></h3>
      <p id="dsgAzure"></p>
      <h3 id="dsgStorageHead"></h3>
      <p id="dsgStorage"></p>
      <h3 id="dsgDeviceHead"></h3>
      <p id="dsgDevice"></p>
      <h3 id="dsgNoneHead"></h3>
      <p id="dsgNone"></p>
      <h3 id="dsgRightsHead"></h3>
      <p id="dsgRights"></p>
      <p class="stand" id="dsgStand"></p>
    </section>

  </div>
</dialog>
`;

export function render(): void {
  mount(document.body, markup);
}
