-- Password sign-in. Email remains the way in for a new account and for recovery, but
-- routine access no longer spends the mail provider's quota.
--
-- passwordChangedAt is also the revocation point: a session issued before it is refused,
-- so changing a password signs every other device out.

ALTER TABLE "User" ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3);
