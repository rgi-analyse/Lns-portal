-- Legg til innstillinger-felt på brukere-tabellen
-- JSON-blob for brukerpreferanser (tts, stt, osv.)
-- Eksempel: { "tts": { "stemmNavn": "nb-NO-PernilleNeural", "hastighet": 1.0, "autoOpplesing": false } }

ALTER TABLE bruker
  ADD innstillinger NVARCHAR(MAX) NULL;
