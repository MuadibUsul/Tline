import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    /** When this session's token was minted, compared against the user's passwordChangedAt. */
    issuedAt?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    issuedAt?: number;
  }
}
