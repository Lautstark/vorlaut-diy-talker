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

        # --- voice ----------------------------------------------------------
        # The names of the voices themselves are not in here: they are proper
        # nouns and come from the installation, not from a table.
        "ui.settings": "Settings",
        # The language names themselves are not in here - "Deutsch" is
        # "Deutsch" in every language, which is the whole point of them.
        "ui.language": "Language",
        "ui.language_title": "Language of this page and of the menu on the "
                             "device",
        "ui.voice": "Voice",
        "ui.voice_auto_note": "picked for this installation",
        # The list is one row until somebody asks for the rest - see
        # static/voices.js. The count is in the label so that asking for it is
        # a decision about a known number, not about an unknown one.
        "ui.voice_show_all": "Show all {n} voices",
        "ui.voice_show_less": "Show fewer",
        "ui.voice_sample": "This is what I sound like",
        "ui.voice_rebuild": "A different voice means every recording is "
                            "spoken again on the next release.",
        "ui.voice_none": "Nothing here can speak yet.",
        # Under the button, and not only when the list is empty: "Fetch
        # voices" said nothing about what arrives, from where, or how big it
        # is, and that is the whole question anybody has about that button.
        "ui.voice_fetch_note": "The offline voices need no account and, once "
                               "they are here, no network. About 130 MB, "
                               "fetched once.",
        "ui.voice_fetch": "Download offline voices",
        "ui.voice_fetching": "fetching {name} ... ({done} of {total})",
        "ui.voice_fetch_done": "The voices are here.",
        "ui.voice_gone": "not available here",
        "ui.azure": "Azure voices",
        "ui.azure_intro": "A key of your own brings more voices and better "
                          "ones. A free account is enough.",
        # The address is in the table, not in the markup, because it is one of
        # the two that differ per language: METACOM sells from a German and an
        # English page, and sending somebody to the wrong one is the same kind
        # of mistake as an untranslated label. Azure follows the same shape so
        # the two read alike. Both have to be https - see static/texts.js.
        "ui.azure_link": "Where the key comes from",
        "ui.azure_link_url":
            "https://azure.microsoft.com/products/ai-foundry/tools/speech",
        "ui.azure_key": "Key",
        # Beside the folded-up heading. What a stored key ends in is in the
        # field itself, as its placeholder - see static/settings.js.
        "ui.azure_key_stored": "stored",
        "ui.azure_key_none": "not stored",
        "ui.azure_key_placeholder": "paste the key here",
        "ui.azure_region": "Region",
        "ui.azure_local_only": "Only on the computer this runs on. On a phone "
                               "everything else can be edited, but not this.",
        "ui.symbols": "Symbols",
        "ui.metacom_intro": "A licensed METACOM collection is searched "
                            "alongside ARASAAC. The symbols stay where they "
                            "are and are only referenced.",
        "ui.metacom_link": "Where a licence comes from",
        "ui.metacom_link_url":
            "https://www.metacom-symbole.de/en/licensing.html",
        "ui.metacom_path": "Folder of the collection",
        "ui.metacom_ok": "{count} symbols, {kind}",
        "ui.metacom_keywords": "with keywords",
        "ui.metacom_names": "file names only",
        "ui.metacom_bad": "nothing readable in that folder",
        "ui.metacom_none": "not set - searching ARASAAC alone",
        "ui.metacom_fixed": "set by docker-compose.yml, not here. That is the "
                            "path inside the container; the folder on the "
                            "machine stands in the mount that puts it there.",
        # The same thing in the width of a heading.
        "ui.metacom_short_none": "not set",
        "ui.settings_saved": "saved",
        "ui.metacom_offer": "Have a METACOM licence? Add the folder under the gear, and it is searched alongside this.",
        "ui.voice_failed": "The list of voices could not be loaded: {error}",

        # --- pairing --------------------------------------------------------
        "ui.pair_title": "A talker wants to be paired",
        "ui.pair_note": "Type the five digits it is showing - each box sits "
                        "where its display sits.",
        "ui.pair_confirm": "Pair",
        "ui.pair_left": "{left} tries left",
        "ui.pair_done": "Paired. The talker can fetch content now.",
        "ui.pair_failed": "Pairing failed: {error}",
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
        "ui.save": "Save",
        "ui.cancel": "Cancel",
        "ui.search_arasaac": "Search ARASAAC, e.g. drinking",
        "ui.search_both": "Search METACOM and ARASAAC, e.g. drinking",
        "ui.searching": "searching ...",
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
        "err.settings_local_only": "The Azure key can only be set on the "
                                   "computer this runs on - not over the "
                                   "network.",
        "err.settings_write": "The settings could not be written: {reason}",
        "err.pair_wrong_code": "Those five digits do not match. Compare them "
                                "with the displays.",
        "err.pair_expired": "No device is waiting to be paired. Start it at the "
                             "talker again.",
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
        "build.err.no_voice": "not in the cache, and there is no voice here to "
                              "speak it with - neither a piper model nor an "
                              "AZURE_SPEECH_KEY",
        "build.err.mklittlefs": "mklittlefs failed: {reason}",
        "build.slot_text": "{label} slot {slot}: \"{text}\"",
        "build.slot_no_voice": "{label} slot {slot}: \"{text}\" {reason}.",
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
        "build.err.audio_required": "Sentences stayed silent, and this build "
                                    "was asked not to allow that. An image "
                                    "with silent keys is worse than no image.",
        "build.err.fs_size": "The LittleFS image is {found} bytes, the "
                             "partition holds {expected}. mklittlefs writes "
                             "the full size - this one is not that image.",
        "build.err.image_short": "{name} is only {found} KiB, the file area "
                                 "ends at {needed} KiB. That is not a whole-"
                                 "flash image.",
        "build.err.area_not_free": "{name} already has something at {offset}, "
                                   "where the file area belongs. Either the "
                                   "partition scheme is a different one or the "
                                   "program has grown into it - nothing was "
                                   "written.",

        # --- the Open Board Format converter --------------------------------
        # What stops a conversion, and what a document is only told about.
        # See docs/obf.md; obf.py is what raises them.
        "obf.err.metacom_pixels": "Image {name} comes from the METACOM "
                                  "collection, so it may be referred to but "
                                  "never stored: {field} would carry the "
                                  "picture itself. Nothing was written.",
        "obf.err.not_a_zip": "{name} is not a readable .obz: {reason}",
        "obf.err.no_boards": "{name} has no board in it.",
        "obf.check.no_root": "The manifest names {name} as the root board, "
                             "and no such board is here.",
        "obf.check.format": "Board {board} says format {found}, expected "
                            "{expected}.",
        "obf.check.no_image": "Board {board}, key {button}: there is no image "
                              "{image} in this board.",
        "obf.check.no_sound": "Board {board}, key {button}: there is no sound "
                              "{sound} in this board.",
        "obf.check.not_a_reference": "Board {board}, image {image} is not a "
                                     "symbol reference. A picture carried as "
                                     "pixels has nowhere to go in layout.json.",
        "obf.check.unknown_set": "Board {board}, image {image} comes from the "
                                 "collection {set}, which is not one this "
                                 "installation can resolve.",
        "obf.check.metacom_pixels": "Board {board}, image {image} is METACOM "
                                    "and carries {field}. That collection may "
                                    "only be referred to.",
        "obf.check.broken_link": "Board {board}, key {button} leads to "
                                 "{target}, which is not in this document.",
        "obf.check.orphan": "Board {board} is not reachable from the root - "
                            "nothing links to it.",
        "obf.check.too_many_boards": "{found} boards are switched on, {profile} "
                                     "takes {max}.",
        "obf.check.too_many_keys": "Board {board} has {found} speech keys, "
                                   "{profile} has {max}.",
        "obf.check.grid": "Board {board} is a {found} grid, {profile} draws "
                          "{expected}.",
        "obf.check.not_a_ring": "Board {board} leads to {found} other boards, "
                                "{profile} has one set key and therefore "
                                "exactly one.",
        "obf.check.action": "Board {board}, key {button} performs {action}. "
                            "{profile} speaks stored sentences and does "
                            "nothing else.",
        "obf.check.hidden": "Board {board}, key {button} is hidden. On "
                            "{profile} a key is a display and cannot be.",
        "obf.check.too_big": "The document comes to at least {used} KiB, and "
                             "{profile} holds {fits} KiB.",

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
        "tts.err.no_piper": "piper not found. It comes with the piper-tts "
                            "package:  pip install piper-tts",
        "tts.err.no_model": "The voice {model} is not on this computer. Fetch "
                            "the voices with:  python3 tools/voices.py",
        "tts.err.piper": "piper failed: {reason}",
        "tts.err.voice_download": "The voice {name} could not be fetched: {reason}",
    },

    "de": {
        # --- header ---------------------------------------------------------
        "ui.preview": "Vorschau",
        "ui.preview_title": "Zeigt zusätzlich, wie groß und wie grob es auf "
                            "dem Display ankommt",

        # --- Stimme ---------------------------------------------------------
        "ui.settings": "Einstellungen",
        "ui.language": "Sprache",
        "ui.language_title": "Sprache dieser Seite und des Menüs auf dem Gerät",
        "ui.voice": "Stimme",
        "ui.voice_auto_note": "für diese Installation gewählt",
        "ui.voice_show_all": "Alle {n} Stimmen zeigen",
        "ui.voice_show_less": "Weniger zeigen",
        "ui.voice_sample": "So klinge ich",
        "ui.voice_rebuild": "Eine andere Stimme heißt: Beim nächsten "
                            "Freigeben wird jede Aufnahme neu gesprochen.",
        "ui.voice_none": "Hier kann noch nichts sprechen.",
        "ui.voice_fetch_note": "Die Stimmen für offline brauchen kein Konto "
                               "und, wenn sie da sind, kein Netz. Etwa 130 MB, "
                               "einmalig geladen.",
        "ui.voice_fetch": "Offline-Stimmen herunterladen",
        "ui.voice_fetching": "holt {name} ... ({done} von {total})",
        "ui.voice_fetch_done": "Die Stimmen sind da.",
        "ui.voice_gone": "hier nicht verfügbar",
        "ui.azure": "Azure-Stimmen",
        "ui.azure_intro": "Ein eigener Schlüssel bringt mehr und bessere "
                          "Stimmen. Ein kostenloses Konto reicht.",
        "ui.azure_link": "Woher der Schlüssel kommt",
        "ui.azure_link_url":
            "https://azure.microsoft.com/products/ai-foundry/tools/speech",
        "ui.azure_key": "Schlüssel",
        "ui.azure_key_stored": "hinterlegt",
        "ui.azure_key_none": "nicht hinterlegt",
        "ui.azure_key_placeholder": "Schlüssel hier einfügen",
        "ui.azure_region": "Region",
        "ui.azure_local_only": "Nur an dem Rechner, auf dem das hier läuft. "
                               "Am Handy lässt sich alles andere ändern, "
                               "das hier nicht.",
        "ui.symbols": "Symbole",
        "ui.metacom_intro": "Eine lizenzierte METACOM-Sammlung wird neben "
                            "ARASAAC durchsucht. Die Symbole bleiben, wo sie "
                            "sind, und werden nur referenziert.",
        "ui.metacom_link": "Woher eine Lizenz kommt",
        "ui.metacom_link_url":
            "https://www.metacom-symbole.de/bestellung/lizenzvarianten.html",
        "ui.metacom_path": "Ordner der Sammlung",
        "ui.metacom_ok": "{count} Symbole, {kind}",
        "ui.metacom_keywords": "mit Schlagwörtern",
        "ui.metacom_names": "nur Dateinamen",
        "ui.metacom_bad": "in dem Ordner ist nichts Lesbares",
        "ui.metacom_none": "nicht gesetzt - es wird nur ARASAAC durchsucht",
        "ui.metacom_fixed": "kommt aus docker-compose.yml, nicht von hier. Das "
                            "ist der Pfad im Container; der Ordner auf dem "
                            "Rechner steht in der Einbindung, die ihn dorthin "
                            "bringt.",
        "ui.metacom_short_none": "nicht gesetzt",
        "ui.settings_saved": "gespeichert",
        "ui.metacom_offer": "Du hast eine METACOM-Lizenz? Trag den Ordner beim Zahnrad ein, dann wird er hier mit durchsucht.",
        "ui.voice_failed": "Die Liste der Stimmen kam nicht an: {error}",

        # --- Koppeln --------------------------------------------------------
        "ui.pair_title": "Ein Talker möchte gekoppelt werden",
        "ui.pair_note": "Tipp die fünf Ziffern ein, die er zeigt - jedes Feld "
                        "steht da, wo sein Display steht.",
        "ui.pair_confirm": "Koppeln",
        "ui.pair_left": "noch {left} Versuche",
        "ui.pair_done": "Gekoppelt. Der Talker kann jetzt Inhalte holen.",
        "ui.pair_failed": "Koppeln fehlgeschlagen: {error}",
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
        "ui.save": "Speichern",
        "ui.cancel": "Abbrechen",
        "ui.search_arasaac": "ARASAAC durchsuchen, z.B. trinken",
        "ui.search_both": "METACOM und ARASAAC durchsuchen, z.B. trinken",
        "ui.searching": "sucht ...",
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
        "err.settings_local_only": "Der Azure-Schlüssel lässt sich nur an "
                                   "dem Rechner setzen, auf dem das hier "
                                   "läuft - nicht übers Netz.",
        "err.settings_write": "Die Einstellungen ließen sich nicht "
                              "schreiben: {reason}",
        "err.pair_wrong_code": "Diese fünf Ziffern passen nicht. Vergleich sie "
                                "mit den Displays.",
        "err.pair_expired": "Es wartet kein Gerät aufs Koppeln. Starte es am "
                             "Talker noch einmal.",
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
        "build.err.no_voice": "nicht im Cache, und hier ist keine Stimme, die "
                              "es sprechen könnte - weder ein Piper-Modell "
                              "noch ein AZURE_SPEECH_KEY",
        "build.err.mklittlefs": "mklittlefs fehlgeschlagen: {reason}",
        "build.slot_text": "{label} Slot {slot}: \"{text}\"",
        "build.slot_no_voice": "{label} Slot {slot}: \"{text}\" {reason}.",
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
        "build.err.audio_required": "Es sind Sätze stumm geblieben, und dieser "
                                    "Build sollte das nicht durchgehen lassen. "
                                    "Ein Abbild mit stummen Tasten ist "
                                    "schlechter als gar keines.",
        "build.err.fs_size": "Das LittleFS-Image ist {found} Bytes groß, die "
                             "Partition fasst {expected}. mklittlefs schreibt "
                             "immer die volle Größe - das hier ist nicht "
                             "dieses Image.",
        "build.err.image_short": "{name} ist nur {found} KiB groß, der "
                                 "Dateibereich endet bei {needed} KiB. Das ist "
                                 "kein Abbild des ganzen Flash.",
        "build.err.area_not_free": "In {name} steht bei {offset} schon etwas, "
                                   "wo der Dateibereich hingehört. Entweder "
                                   "ist das Partitionsschema ein anderes oder "
                                   "das Programm ist hineingewachsen - es "
                                   "wurde nichts geschrieben.",

        # --- the Open Board Format converter --------------------------------
        "obf.err.metacom_pixels": "Das Bild {name} kommt aus der "
                                  "METACOM-Sammlung, darf also verwiesen, aber "
                                  "nie gespeichert werden: {field} würde das "
                                  "Bild selbst mitnehmen. Es wurde nichts "
                                  "geschrieben.",
        "obf.err.not_a_zip": "{name} ist kein lesbares .obz: {reason}",
        "obf.err.no_boards": "In {name} steht kein einziges Board.",
        "obf.check.no_root": "Das Manifest nennt {name} als Wurzel-Board, und "
                             "ein solches Board ist nicht dabei.",
        "obf.check.format": "Board {board} sagt Format {found}, erwartet ist "
                            "{expected}.",
        "obf.check.no_image": "Board {board}, Taste {button}: ein Bild {image} "
                              "gibt es in diesem Board nicht.",
        "obf.check.no_sound": "Board {board}, Taste {button}: einen Ton "
                              "{sound} gibt es in diesem Board nicht.",
        "obf.check.not_a_reference": "Board {board}, Bild {image} ist kein "
                                     "Symbolverweis. Ein Bild, das die Pixel "
                                     "mitbringt, hat in layout.json keinen "
                                     "Platz.",
        "obf.check.unknown_set": "Board {board}, Bild {image} kommt aus der "
                                 "Sammlung {set}, die diese Installation nicht "
                                 "auflösen kann.",
        "obf.check.metacom_pixels": "Board {board}, Bild {image} ist METACOM "
                                    "und führt {field} mit. Auf diese Sammlung "
                                    "darf nur verwiesen werden.",
        "obf.check.broken_link": "Board {board}, Taste {button} führt zu "
                                 "{target} - das steht nicht in diesem "
                                 "Dokument.",
        "obf.check.orphan": "Board {board} ist von der Wurzel aus nicht "
                            "erreichbar - nichts verweist darauf.",
        "obf.check.too_many_boards": "{found} Boards sind eingeschaltet, "
                                     "{profile} nimmt {max}.",
        "obf.check.too_many_keys": "Board {board} hat {found} Sprechtasten, "
                                   "{profile} hat {max}.",
        "obf.check.grid": "Board {board} ist ein {found}-Raster, {profile} "
                          "zeichnet {expected}.",
        "obf.check.not_a_ring": "Board {board} führt zu {found} anderen "
                                "Boards, {profile} hat eine Set-Taste und "
                                "damit genau eines.",
        "obf.check.action": "Board {board}, Taste {button} führt {action} aus. "
                            "{profile} spricht gespeicherte Sätze und sonst "
                            "nichts.",
        "obf.check.hidden": "Board {board}, Taste {button} ist versteckt. Auf "
                            "{profile} ist eine Taste ein Display und kann das "
                            "nicht sein.",
        "obf.check.too_big": "Das Dokument kommt auf mindestens {used} KiB, "
                             "und {profile} fasst {fits} KiB.",

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
        "tts.err.no_piper": "piper nicht gefunden. Es kommt mit dem Paket "
                            "piper-tts:  pip install piper-tts",
        "tts.err.no_model": "Die Stimme {model} liegt nicht auf diesem "
                            "Rechner. Stimmen holen mit:  python3 "
                            "tools/voices.py",
        "tts.err.piper": "piper fehlgeschlagen: {reason}",
        "tts.err.voice_download": "Die Stimme {name} kam nicht an: {reason}",
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
