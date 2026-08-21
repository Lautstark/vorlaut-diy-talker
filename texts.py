"""Every word the user reads, in one place - the counterpart to texts.h.

The split in this project runs by readership: what a developer reads is
English, what the family reads is theirs. That works as long as the two never
meet. They do meet in one spot: the build log and the error messages are
written by the CLI and shown in the web interface.

So those messages are not strings any more but keys. build.py and tts.py say
which message and with which values; who renders it decides the language. The
command line renders English, the web interface renders whatever layout.json
asks for.

Adding a language means one more block below, and the same code in
firmware/vorlaut/texts.h if the device is to speak it too.
tests/test_ui_texts.py checks that the blocks stay in step.
"""

from __future__ import annotations

DEFAULT = "en"

# Keys are grouped by where they appear, not alphabetically - a translator
# reads them in the order they meet them on screen.
TEXTS: dict[str, dict[str, str]] = {
    "en": {
        # --- header ---------------------------------------------------------
        "ui.preview": "Preview",
        "ui.preview_title": "Also shows how big and how coarse it arrives on "
                            "the display",
        "ui.language_title": "Language of this page and of the menu on the "
                             "device",
        "ui.release": "Release",
        "ui.release_needed": "There are changes the device cannot fetch yet - "
                             "release them to make this state available",
        "ui.release_current": "The device can fetch this state",

        # --- conflict banner ------------------------------------------------
        "ui.keep_mine": "Keep my version",
        "ui.reload": "Reload",
        "ui.conflict_elsewhere": "Not saved: layout.json was changed somewhere "
                                 "else in the meantime. What is on this screen "
                                 "is still here.",
        "ui.conflict_mismatch": "Careful: the file does not contain what is "
                                "shown here. Please check the text and report "
                                "it - this is a bug in the program.",

        # --- status line ----------------------------------------------------
        "ui.unsaved": "not saved yet",
        "ui.not_saved": "not saved",
        "ui.saved_wrong": "NOT saved properly",
        "ui.saved": "saved",
        "ui.save_failed": "Error while saving: {error}",
        "ui.load_failed": "Loading failed: {error}",

        # --- sets and keys --------------------------------------------------
        "ui.pick_symbol": "Pick a symbol",
        "ui.device_size": "this big on the device",
        "ui.symbol_missing": "missing from symbols/",
        "ui.no_symbol": "no symbol",
        "ui.tab_off": "Not on the device",
        "ui.tab_on": "Goes onto the device",
        "ui.set_n": "Set {n}",
        "ui.add_set": "+ Set",
        "ui.no_sets": "No sets yet. Click \"+ Set\" above.",
        "ui.set_key": "SET KEY",
        "ui.key_n": "KEY {n}",
        "ui.set_name": "Name of the set",
        "ui.active": "Active",
        "ui.active_title": "Active sets go onto the device - at most {max} at "
                           "a time",
        "ui.active_full": "{max} sets are already active - switch one off "
                          "first.",
        "ui.colour_title": "Pick the colour of the set",
        "ui.ready_not_on_device": "ready, not on the device",
        "ui.grip_title": "Drag to swap with another key",
        "ui.text_placeholder": "What gets said",
        "ui.play_title": "Listen",
        "ui.none_active": "No set is active - the device would only show a "
                          "notice. {n} sets are ready.",
        "ui.slots_used": "{used} of {max} places on the device taken",
        "ui.sets_created": "{n} sets created",
        "ui.confirm_delete": "Really delete set \"{name}\"?",
        "ui.remove_set": "Delete this set",

        # --- speaking a sentence --------------------------------------------
        "ui.need_text": "Enter some text first.",
        "ui.play_failed": "Cannot play: {error}",

        # --- the symbol picker ----------------------------------------------
        "ui.search": "Search",
        "ui.own_image": "Own picture",
        "ui.close": "Close",
        "ui.search_arasaac": "Search ARASAAC, e.g. drinking",
        "ui.search_both": "Search METACOM and ARASAAC, e.g. drinking",
        "ui.nothing_found": "Nothing found for „{word}“.",
        "ui.arasaac_down": "ARASAAC not reachable - METACOM hits only.",
        "ui.taking_symbol": "taking symbol ...",
        "ui.loading_symbol": "loading symbol ...",
        "ui.symbol_failed": "Could not load the symbol: {error}",
        "ui.uploading": "uploading picture ...",
        "ui.upload_done": "picture taken",
        "ui.upload_failed": "Upload failed: {error}",
        "ui.credits_arasaac": "Pictograms: ARASAAC, author Sergio Palao, "
                              "licence CC BY-NC-SA.",
        "ui.credits_both": "Symbols: METACOM 9 (Annette Kitzinger), licensed "
                           "for this computer - they are only referenced, not "
                           "copied into the project. Pictograms: ARASAAC, "
                           "author Sergio Palao, licence CC BY-NC-SA.",

        # --- building -------------------------------------------------------
        "ui.releasing": "releasing ...",
        "ui.running": "running ...",
        "ui.released": "released",
        "ui.release_failed": "Release failed",
        "ui.log_error": "Error: {error}",

        # --- what the server answers ----------------------------------------
        "err.bad_token": "Wrong or missing key.",
        "err.no_image_data": "No image data arrived.",
        "err.image_too_big": "The picture is too big (at most {mb} MB).",
        "err.arasaac_unreachable": "ARASAAC not reachable: {reason}",
        "err.file_not_found": "File not found.",
        "err.symbol_not_found": "Symbol not found.",
        "err.preview_failed": "Preview cannot be loaded: {reason}",
        "err.not_found": "Not found.",
        "err.bad_json": "Invalid JSON.",
        "err.not_an_image": "That is not a readable picture.",
        "err.no_such_metacom": "There is no such METACOM symbol.",
        "err.download_failed": "Download failed: {reason}",
        "err.no_device_sync": "Device sync is not set up - "
                              "VORLAUT_DEVICE_TOKEN is missing.",
        "err.stale_page": "This page holds an older state - layout.json was "
                          "changed somewhere else in the meantime.",
        "ui.app_description": "Edit the content for the talker",

        # --- the build log --------------------------------------------------
        "build.no_sets": "layout.json contains no sets - there is nothing to "
                         "build.",
        "build.none_active": "No set is active - the device would have nothing "
                             "to show.",
        "build.active_count": "{active} of {total} sets active.",
        "build.no_set_symbol": "{label}: no set symbol chosen yet.",
        "build.no_text": "{label} slot {slot}: no text - no sound.",
        "build.tts_failed": "WARNING: TTS failed for \"{text}\": {reason}",
        "build.removed": "removed: {name}",
        "build.written": "written: {name}",
        "build.audio_missing": "Note: sound files are missing - see the "
                               "warnings above.",
        "build.done": "Done: {sets} set(s), {files} files, {size} KiB in "
                      "{where}",
        "build.next_steps": "That does not put the files on the device yet. "
                            "For that:",
        "build.next_command": "  python build.py --fs-image   and the command "
                              "it prints",
        "build.next_docs": "  details in docs/firmware.md",
        "build.filled_from_example": "content/ filled with the examples from "
                                     "example/.",

        # --- what stops a build ---------------------------------------------
        "build.err.not_found": "{name} not found.",
        "build.err.bad_json": "{name} is not valid JSON: {reason}",
        "build.err.sets_not_list": "\"sets\" has to be a list.",
        "build.err.too_many_sets": "At most {max} sets, found: {found}.",
        "build.err.too_many_slots": "Set {set} has {found} slots, exactly "
                                    "{expected} are allowed.",
        "build.err.too_many_active": "At most {max} sets active at once, "
                                     "{found} are chosen. More do not fit on "
                                     "the device.",
        "build.err.no_pillow": "Pillow is missing. Install it with:  pip "
                               "install -r requirements.txt",
        "build.err.no_key": "not in the cache and without AZURE_SPEECH_KEY it "
                            "cannot be spoken",
        "build.err.mklittlefs": "mklittlefs failed: {reason}",
        "build.slot_text": "{label} slot {slot}: \"{text}\"",
        "build.slot_no_key": "{label} slot {slot}: \"{text}\" {reason}.",
        "build.missing_metacom_off": "Symbol {symbol} comes from the METACOM "
                                     "collection, but VORLAUT_METACOM_DIR is "
                                     "not set.",
        "build.missing_metacom": "Symbol {symbol} is not in the METACOM "
                                 "collection.",
        "build.missing_symbol": "Symbol {symbol} is missing from symbols/.",
        "build.missing_prefixed": "{label}: {what}",
        "build.missing_in_slot": "{label} slot {slot}: {what}",
        "build.err.no_mklittlefs": "mklittlefs not found. It comes with the "
                                   "ESP32 core of the Arduino IDE; without it "
                                   "no image can be built.",
        "build.err.too_big": "The data is {used} KiB, the file area holds only "
                             "{fits} KiB.",

        # --- speech output ---------------------------------------------------
        "tts.err.azure": "Azure error {code}: {detail}",
        "tts.err.unreachable": "Azure not reachable: {reason}",
        "tts.err.no_ffmpeg": "ffmpeg not found. On macOS: brew install ffmpeg",
        "tts.err.ffmpeg": "ffmpeg failed: {reason}",
        "tts.err.empty": "Empty text cannot be spoken.",
        "tts.err.no_key": "AZURE_SPEECH_KEY is missing. Either set it as an "
                          "environment variable or write it into .env "
                          "(template: .env.example).",
        "tts.err.rejected": "Azure rejects the key (401). Do the key and the "
                            "region ({region}) match?",
    },

    "de": {
        # --- header ---------------------------------------------------------
        "ui.preview": "Vorschau",
        "ui.preview_title": "Zeigt zusätzlich, wie groß und wie grob es auf "
                            "dem Display ankommt",
        "ui.language_title": "Sprache dieser Seite und des Menüs auf dem Gerät",
        "ui.release": "Freigeben",
        "ui.release_needed": "Es gibt Änderungen, die das Gerät noch nicht "
                             "holen kann - freigeben macht diesen Stand "
                             "verfügbar",
        "ui.release_current": "Diesen Stand kann das Gerät holen",

        # --- conflict banner ------------------------------------------------
        "ui.keep_mine": "Meinen Stand behalten",
        "ui.reload": "Neu laden",
        "ui.conflict_elsewhere": "Nicht gespeichert: layout.json wurde "
                                 "zwischenzeitlich woanders geändert. Was hier "
                                 "auf dem Bildschirm steht, ist noch da.",
        "ui.conflict_mismatch": "Achtung: Die Datei enthält nicht das, was "
                                "hier steht. Bitte den Text prüfen und melden "
                                "- das ist ein Fehler im Programm.",

        # --- status line ----------------------------------------------------
        "ui.unsaved": "noch nicht gespeichert",
        "ui.not_saved": "nicht gespeichert",
        "ui.saved_wrong": "NICHT richtig gespeichert",
        "ui.saved": "gespeichert",
        "ui.save_failed": "Fehler beim Speichern: {error}",
        "ui.load_failed": "Laden fehlgeschlagen: {error}",

        # --- sets and keys --------------------------------------------------
        "ui.pick_symbol": "Symbol wählen",
        "ui.device_size": "so groß auf dem Gerät",
        "ui.symbol_missing": "fehlt in symbols/",
        "ui.no_symbol": "kein Symbol",
        "ui.tab_off": "Nicht auf dem Gerät",
        "ui.tab_on": "Geht aufs Gerät",
        "ui.set_n": "Set {n}",
        "ui.add_set": "+ Set",
        "ui.no_sets": "Noch keine Sets. Oben auf \"+ Set\" klicken.",
        "ui.set_key": "SET-TASTE",
        "ui.key_n": "TASTE {n}",
        "ui.set_name": "Name des Sets",
        "ui.active": "Aktiv",
        "ui.active_title": "Aktive Sets gehen aufs Gerät - höchstens {max} "
                           "gleichzeitig",
        "ui.active_full": "Es sind schon {max} Sets aktiv - erst eins "
                          "abschalten.",
        "ui.colour_title": "Farbe des Sets wählen",
        "ui.ready_not_on_device": "liegt bereit, nicht auf dem Gerät",
        "ui.grip_title": "Ziehen, um mit einer anderen Taste zu tauschen",
        "ui.text_placeholder": "Was gesagt wird",
        "ui.play_title": "Vorhören",
        "ui.none_active": "Kein Set aktiv - das Gerät zeigt dann nur einen "
                          "Hinweis an. {n} Sets liegen bereit.",
        "ui.slots_used": "{used} von {max} Plätzen auf dem Gerät belegt",
        "ui.sets_created": "{n} Sets angelegt",
        "ui.confirm_delete": "Set \"{name}\" wirklich löschen?",
        "ui.remove_set": "Dieses Set löschen",

        # --- speaking a sentence --------------------------------------------
        "ui.need_text": "Erst einen Text eintragen.",
        "ui.play_failed": "Vorhören nicht möglich: {error}",

        # --- the symbol picker ----------------------------------------------
        "ui.search": "Suchen",
        "ui.own_image": "Eigenes Bild",
        "ui.close": "Schließen",
        "ui.search_arasaac": "ARASAAC durchsuchen, z.B. trinken",
        "ui.search_both": "METACOM und ARASAAC durchsuchen, z.B. trinken",
        "ui.nothing_found": "Nichts gefunden zu „{word}“.",
        "ui.arasaac_down": "ARASAAC nicht erreichbar - nur METACOM-Treffer.",
        "ui.taking_symbol": "übernimmt Symbol ...",
        "ui.loading_symbol": "lädt Symbol ...",
        "ui.symbol_failed": "Symbol konnte nicht geladen werden: {error}",
        "ui.uploading": "lädt Bild hoch ...",
        "ui.upload_done": "Bild übernommen",
        "ui.upload_failed": "Upload fehlgeschlagen: {error}",
        "ui.credits_arasaac": "Piktogramme: ARASAAC, Urheber Sergio Palao, "
                              "Lizenz CC BY-NC-SA.",
        "ui.credits_both": "Symbole: METACOM 9 (Annette Kitzinger), lizenziert "
                           "für diesen Rechner - sie werden nur verwiesen, "
                           "nicht ins Projekt kopiert. Piktogramme: ARASAAC, "
                           "Urheber Sergio Palao, Lizenz CC BY-NC-SA.",

        # --- building -------------------------------------------------------
        "ui.releasing": "gibt frei ...",
        "ui.running": "läuft ...",
        "ui.released": "freigegeben",
        "ui.release_failed": "Freigeben fehlgeschlagen",
        "ui.log_error": "Fehler: {error}",

        # --- what the server answers ----------------------------------------
        "err.bad_token": "Falscher oder fehlender Schlüssel.",
        "err.no_image_data": "Es kamen keine Bilddaten an.",
        "err.image_too_big": "Das Bild ist zu groß (höchstens {mb} MB).",
        "err.arasaac_unreachable": "ARASAAC nicht erreichbar: {reason}",
        "err.file_not_found": "Datei nicht gefunden.",
        "err.symbol_not_found": "Symbol nicht gefunden.",
        "err.preview_failed": "Vorschau nicht ladbar: {reason}",
        "err.not_found": "Nicht gefunden.",
        "err.bad_json": "Ungültiges JSON.",
        "err.not_an_image": "Das ist kein lesbares Bild.",
        "err.no_such_metacom": "Dieses METACOM-Symbol gibt es nicht.",
        "err.download_failed": "Download fehlgeschlagen: {reason}",
        "err.no_device_sync": "Der Geräte-Abgleich ist nicht eingerichtet - "
                              "VORLAUT_DEVICE_TOKEN fehlt.",
        "err.stale_page": "Diese Seite hat einen veralteten Stand - "
                          "layout.json wurde zwischenzeitlich woanders "
                          "geändert.",
        "ui.app_description": "Inhalte für den Talker bearbeiten",

        # --- the build log --------------------------------------------------
        "build.no_sets": "layout.json enthält keine Sets - es gibt nichts zu "
                         "bauen.",
        "build.none_active": "Kein Set ist aktiv - das Gerät hätte nichts "
                             "anzuzeigen.",
        "build.active_count": "{active} von {total} Sets aktiv.",
        "build.no_set_symbol": "{label}: noch kein Set-Symbol gewählt.",
        "build.no_text": "{label} Slot {slot}: kein Text - kein Ton.",
        "build.tts_failed": "WARNUNG: TTS fehlgeschlagen bei \"{text}\": "
                            "{reason}",
        "build.removed": "entfernt: {name}",
        "build.written": "geschrieben: {name}",
        "build.audio_missing": "Hinweis: Es fehlen Tondateien - siehe "
                               "Warnungen oben.",
        "build.done": "Fertig: {sets} Set(s), {files} Dateien, {size} KiB in "
                      "{where}",
        "build.next_steps": "Aufs Gerät kommen die Dateien damit noch nicht. "
                            "Dafür:",
        "build.next_command": "  python build.py --fs-image   und der Befehl, "
                              "den es ausgibt",
        "build.next_docs": "  Einzelheiten in docs/firmware.md",
        "build.filled_from_example": "content/ mit den Beispielen aus example/ "
                                     "gefüllt.",

        # --- what stops a build ---------------------------------------------
        "build.err.not_found": "{name} nicht gefunden.",
        "build.err.bad_json": "{name} ist kein gültiges JSON: {reason}",
        "build.err.sets_not_list": "\"sets\" muss eine Liste sein.",
        "build.err.too_many_sets": "Höchstens {max} Sets, gefunden: {found}.",
        "build.err.too_many_slots": "Set {set} hat {found} Slots, erlaubt sind "
                                    "genau {expected}.",
        "build.err.too_many_active": "Höchstens {max} Sets gleichzeitig aktiv, "
                                     "gewählt sind {found}. Mehr passen nicht "
                                     "aufs Gerät.",
        "build.err.no_pillow": "Pillow fehlt. Installieren mit:  pip install "
                               "-r requirements.txt",
        "build.err.no_key": "nicht im Cache und ohne AZURE_SPEECH_KEY lässt es "
                            "sich nicht sprechen",
        "build.err.mklittlefs": "mklittlefs fehlgeschlagen: {reason}",
        "build.slot_text": "{label} Slot {slot}: \"{text}\"",
        "build.slot_no_key": "{label} Slot {slot}: \"{text}\" {reason}.",
        "build.missing_metacom_off": "Symbol {symbol} kommt aus der "
                                     "METACOM-Sammlung, aber "
                                     "VORLAUT_METACOM_DIR ist nicht gesetzt.",
        "build.missing_metacom": "Symbol {symbol} steht nicht in der "
                                 "METACOM-Sammlung.",
        "build.missing_symbol": "Symbol {symbol} fehlt in symbols/.",
        "build.missing_prefixed": "{label}: {what}",
        "build.missing_in_slot": "{label} Slot {slot}: {what}",
        "build.err.no_mklittlefs": "mklittlefs nicht gefunden. Es kommt mit "
                                   "dem ESP32-Core der Arduino-IDE; ohne das "
                                   "lässt sich kein Image bauen.",
        "build.err.too_big": "Die Daten sind {used} KiB, der Dateibereich "
                             "fasst nur {fits} KiB.",

        # --- speech output ---------------------------------------------------
        "tts.err.azure": "Azure-Fehler {code}: {detail}",
        "tts.err.unreachable": "Azure nicht erreichbar: {reason}",
        "tts.err.no_ffmpeg": "ffmpeg nicht gefunden. Unter macOS: brew install "
                             "ffmpeg",
        "tts.err.ffmpeg": "ffmpeg fehlgeschlagen: {reason}",
        "tts.err.empty": "Leerer Text lässt sich nicht sprechen.",
        "tts.err.no_key": "AZURE_SPEECH_KEY fehlt. Entweder als Umgebungs-"
                          "variable setzen oder in die Datei .env "
                          "schreiben (Vorlage: .env.example).",
        "tts.err.rejected": "Azure lehnt den Key ab (401). Stimmen Key und "
                            "Region ({region}) zusammen?",
    },
}


def t(key: str, lang: str = DEFAULT, **params) -> str:
    """One message, rendered.

    An unknown language falls back to the default, an unknown key to the key
    itself - a missing translation should show up as an odd label, not as a
    crash in the middle of a build.
    """
    table = TEXTS.get(lang) or TEXTS[DEFAULT]
    raw = table.get(key) or TEXTS[DEFAULT].get(key) or key
    try:
        return raw.format(**params) if params else raw
    except (KeyError, IndexError):
        return raw


def ui_texts(lang: str) -> dict[str, str]:
    """The ui.* entries for one language, for handing to the browser.

    Only those: the page has no business with the build log's keys, and the
    fewer bytes travel in the HTML the better.
    """
    table = TEXTS.get(lang) or TEXTS[DEFAULT]
    fallback = TEXTS[DEFAULT]
    return {key: table.get(key, value)
            for key, value in fallback.items() if key.startswith("ui.")}
