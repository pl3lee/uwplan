\set ON_ERROR_STOP on

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE
  public.session,
  public.verification_token,
  public.account
IN ACCESS EXCLUSIVE MODE;
TRUNCATE TABLE
  public.session,
  public.verification_token,
  public.account;
COMMIT;
