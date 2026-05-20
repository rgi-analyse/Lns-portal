BEGIN TRY

BEGIN TRAN;

-- Flytter harAnalyseTilgang fra UserProfile til Bruker (Steg I).
-- Idempotent: kan kjøres flere ganger trygt. Roger har allerede kjørt
-- pass 1 mot prod-DB; denne filen er for sporbarhet + fremtidig setup.
--
-- Pass 1 (denne migrasjonen): legg til kolonne på Bruker + kopier data.
-- Pass 2 (separat ad-hoc SSMS etter verifisering): drop kolonne fra UserProfile.

-- 1. Legg til kolonne på Bruker hvis den ikke finnes
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE Name = N'harAnalyseTilgang'
    AND Object_ID = Object_ID(N'dbo.Bruker')
)
ALTER TABLE [dbo].[Bruker]
  ADD [harAnalyseTilgang] BIT NOT NULL
      CONSTRAINT [DF_Bruker_harAnalyseTilgang] DEFAULT 0;

-- 2. Kopiér eksisterende verdier fra UserProfile → Bruker
--    LEFT JOIN sikrer at brukere uten UserProfile-rad får 0 (matcher default).
--    Kjøres kun hvis kildekolonnen fortsatt finnes (idempotent ved re-run etter pass 2).
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE Name = N'harAnalyseTilgang'
    AND Object_ID = Object_ID(N'dbo.UserProfile')
)
BEGIN
  UPDATE b
  SET    b.harAnalyseTilgang = ISNULL(up.harAnalyseTilgang, 0)
  FROM   [dbo].[Bruker] b
  LEFT  JOIN [dbo].[UserProfile] up ON up.userId = b.id;
END;

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
