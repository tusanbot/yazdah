import { createClient } from "@supabase/supabase-js";

type Job = {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  attempts: number;
};

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const pollMs = Math.max(500, Number(process.env.WORKER_POLL_MS ?? 2500));
const leaseSeconds = Math.min(900, Math.max(10, Number(process.env.WORKER_LEASE_SECONDS ?? 90)));
let stopping = false;

async function resolveMatch(job: Job) {
  const matchId = job.payload.match_id;
  if (typeof matchId !== "string") throw new Error("match_id_missing");
  const { error } = await supabase.rpc("resolve_match", { p_match_id: matchId });
  if (error) throw new Error(error.message);
  const { error: prizeError } = await supabase.rpc("settle_match_prizes", { p_match_id: matchId });
  if (prizeError) throw new Error(prizeError.message);
}

async function payStaffDaily(job: Job) {
  const clubId = job.payload.club_id;
  const stateDate = job.payload.state_date;
  if (typeof clubId !== "string" || typeof stateDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(stateDate)) {
    throw new Error("payroll_payload_invalid");
  }

  const { data: staff, error } = await supabase.from("club_staff")
    .select("id, full_name, weekly_wage")
    .eq("club_id", clubId)
    .is("released_at", null)
    .gte("contract_until", stateDate);
  if (error) throw new Error(error.message);

  for (const member of staff ?? []) {
    const weeklyWage = Number(member.weekly_wage);
    if (!Number.isSafeInteger(weeklyWage) || weeklyWage < 0) throw new Error("staff_wage_invalid");
    const dailyWage = Math.ceil(weeklyWage / 7);
    if (dailyWage === 0) continue;

    const { error: ledgerError } = await supabase.rpc("post_club_ledger", {
      p_club_id: clubId,
      p_idempotency_key: `staff-payroll:${stateDate}:${member.id}`,
      p_reason: "staff_daily_wage",
      p_amount: -dailyWage,
      p_memo: `Daily wage: ${member.full_name}`,
    });
    if (ledgerError) throw new Error(`payroll_${member.id}: ${ledgerError.message}`);
  }

  const { error: stateError } = await supabase.from("club_daily_state").upsert({
    club_id: clubId,
    state_date: stateDate,
    wages_applied: true,
  }, { onConflict: "club_id,state_date" });
  if (stateError) throw new Error(stateError.message);
}

async function trainPlayersDaily(job: Job) {
  const clubId = job.payload.club_id;
  const stateDate = job.payload.state_date;
  if (typeof clubId !== "string" || typeof stateDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(stateDate)) {
    throw new Error("training_payload_invalid");
  }
  const { data, error } = await supabase.rpc("apply_daily_training", {
    p_club_id: clubId,
    p_state_date: stateDate,
  });
  if (error) throw new Error(error.message);
  console.info(JSON.stringify({ event: "daily_training_applied", clubId, stateDate, playersImproved: data }));
}

async function process(job: Job) {
  switch (job.job_type) {
    case "match.resolve":
      await resolveMatch(job);
      return;
    case "staff.payroll":
      await payStaffDaily(job);
      return;
    case "players.training":
      await trainPlayersDaily(job);
      return;
    default:
      throw new Error(`unsupported_job_type:${job.job_type}`);
  }
}

async function enqueueDueWork() {
  const now = new Date().toISOString();
  const { data: matches, error: matchError } = await supabase.from("matches")
    .select("id, kickoff_at")
    .eq("status", "scheduled")
    .lte("kickoff_at", now)
    .limit(100);
  if (matchError) throw new Error(matchError.message);

  for (const match of matches ?? []) {
    const { error } = await supabase.from("game_jobs").upsert({
      job_type: "match.resolve",
      payload: { match_id: match.id },
      run_at: match.kickoff_at,
      idempotency_key: `match.resolve:${match.id}`,
    }, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  const stateDate = now.slice(0, 10);
  const { data: clubs, error: clubsError } = await supabase.from("clubs").select("id").limit(1000);
  if (clubsError) throw new Error(clubsError.message);

  for (const club of clubs ?? []) {
    const { error } = await supabase.from("game_jobs").upsert({
      job_type: "staff.payroll",
      payload: { club_id: club.id, state_date: stateDate },
      run_at: `${stateDate}T00:05:00.000Z`,
      idempotency_key: `staff.payroll:${stateDate}:${club.id}`,
    }, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    const { error: trainingError } = await supabase.from("game_jobs").upsert({
      job_type: "players.training",
      payload: { club_id: club.id, state_date: stateDate },
      run_at: `${stateDate}T00:05:00.000Z`,
      idempotency_key: `players.training:${stateDate}:${club.id}`,
    }, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (trainingError) throw new Error(trainingError.message);
  }
}

async function pollOnce() {
  const { data, error } = await supabase.rpc("claim_game_job", { p_lease_seconds: leaseSeconds });
  if (error) throw new Error(error.message);
  const job = (data as Job[] | null)?.[0];
  if (!job) return false;

  try {
    await process(job);
    const { error: completeError } = await supabase.rpc("complete_game_job", { p_job_id: job.id });
    if (completeError) throw new Error(completeError.message);
    console.info(JSON.stringify({ event: "job_completed", id: job.id, type: job.job_type }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "worker_unknown_error";
    const { error: failError } = await supabase.rpc("fail_game_job", { p_job_id: job.id, p_error: message });
    if (failError) console.error(JSON.stringify({ event: "job_failure_record_failed", id: job.id, error: failError.message }));
    console.error(JSON.stringify({ event: "job_failed", id: job.id, type: job.job_type, error: message }));
  }
  return true;
}

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

let lastScheduledAt = 0;
while (!stopping) {
  try {
    if (Date.now() - lastScheduledAt >= 60_000) {
      await enqueueDueWork();
      lastScheduledAt = Date.now();
    }
    const found = await pollOnce();
    if (!found) await new Promise((resolve) => setTimeout(resolve, pollMs));
  } catch (error) {
    console.error(JSON.stringify({ event: "worker_poll_error", error: error instanceof Error ? error.message : "unknown" }));
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
