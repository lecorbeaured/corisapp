export const DB_FUNCS = {
  // Phase 2 function names. Adjust in .env if your SQL uses different names.
  generateWindowsForSchedule: process.env.DB_FN_GENERATE_WINDOWS_FOR_SCHEDULE || "coris_generate_paycheck_windows_for_schedule",
  assignToActiveWindowsForUser: process.env.DB_FN_ASSIGN_OCCURRENCES_TO_ACTIVE_WINDOWS || "coris_assign_occurrences_to_active_windows",
  // Optional single refresh function if you later add it
  refreshPlanningForUser: process.env.DB_FN_REFRESH_PLANNING_FOR_USER || ""
  generateOccurrencesForUser: process.env.DB_FN_GENERATE_OCCURRENCES_FOR_USER || "coris_generate_bill_occurrences_for_user"
};
