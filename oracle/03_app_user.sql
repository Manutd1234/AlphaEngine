-- AlphaEngine — least-privilege application user.
--
-- WHY THIS FILE EXISTS
--
-- The blueprint's Vercel matrix puts the ADMIN password in a serverless
-- function's environment. ADMIN on an Autonomous Database is a DBA: anything
-- that can read that variable — a compromised dependency in the build, a
-- mis-scoped preview deployment, a leaked dashboard session — can drop every
-- object in the instance, not just read two tables.
--
-- The web client reads ORACLE_USER and defaults it to ADMIN, so the credentials
-- already configured in Vercel work today with nothing else changed. Running
-- this script and then setting ORACLE_USER=ALPHAENGINE_APP is a one-variable
-- switch, and it is worth making before any public deployment.
--
-- Run as ADMIN:
--   sqlplus ADMIN/"$ORACLE_PASSWORD"@"$ORACLE_CONN_STRING" @oracle/03_app_user.sql
--
-- Then set, in Vercel:
--   ORACLE_USER=ALPHAENGINE_APP
--   ORACLE_PASSWORD=<the password chosen below>

-- Choose a distinct password; do not reuse ADMIN's.
DEFINE app_password = 'CHANGE_ME_before_running_Aa1!'

CREATE USER alphaengine_app IDENTIFIED BY "&app_password";

-- CONNECT alone. No RESOURCE: the application never creates objects, and a
-- quota of zero means a bug in a query cannot consume tablespace either.
GRANT CREATE SESSION TO alphaengine_app;
ALTER USER alphaengine_app QUOTA 0 ON DATA;

-- Exactly the two objects the routes touch, and only the verbs they use.
-- SELECT but not INSERT on the corpus: documents are written by the ingest
-- path (the gateway, with its own credentials), never by a web request.
GRANT SELECT ON strategy_research_rag TO alphaengine_app;
GRANT EXECUTE ON run_monte_carlo_portfolio TO alphaengine_app;

-- Resolve the unqualified names the queries use without forcing a schema
-- prefix into every statement.
CREATE OR REPLACE SYNONYM alphaengine_app.strategy_research_rag FOR strategy_research_rag;
CREATE OR REPLACE SYNONYM alphaengine_app.run_monte_carlo_portfolio FOR run_monte_carlo_portfolio;

-- Bound what one credential can spend, so a runaway caller degrades instead of
-- taking the instance down. ADB's default consumer group does not do this.
CREATE PROFILE alphaengine_app_profile LIMIT
  SESSIONS_PER_USER 8
  IDLE_TIME 5
  CONNECT_TIME 60;
ALTER USER alphaengine_app PROFILE alphaengine_app_profile;
