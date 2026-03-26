import type { Player } from "@/lib/types/database";

export interface TeamProposal {
  teamName: string;
  bibColor: string;
  players: Player[];
  avgSkill: number;
}

const DEFAULT_COLORS = ["White", "Black", "Red"];

export function generateBalancedTeams(
  players: Player[],
  numTeams: 2 | 3
): TeamProposal[] {
  // Step 1: Sort descending by skill
  const sorted = [...players].sort((a, b) => b.skill_rating - a.skill_rating);

  // Step 2: Snake draft distribution
  const teams: Player[][] = Array.from({ length: numTeams }, () => []);

  sorted.forEach((player, index) => {
    const round = Math.floor(index / numTeams);
    const pos = index % numTeams;
    // Snake: even rounds go forward, odd rounds go backward
    const teamIndex = round % 2 === 0 ? pos : numTeams - 1 - pos;
    teams[teamIndex].push(player);
  });

  // Step 3: Greedy optimization — 100 random swaps
  let bestTeams = teams.map((t) => [...t]);
  let bestScore = getBalanceScore(bestTeams);

  for (let i = 0; i < 100; i++) {
    const teamA = Math.floor(Math.random() * numTeams);
    let teamB = Math.floor(Math.random() * numTeams);
    while (teamB === teamA) teamB = Math.floor(Math.random() * numTeams);

    const playerA = Math.floor(Math.random() * bestTeams[teamA].length);
    const playerB = Math.floor(Math.random() * bestTeams[teamB].length);

    if (bestTeams[teamA].length === 0 || bestTeams[teamB].length === 0) continue;

    // Swap
    const trial = bestTeams.map((t) => [...t]);
    const temp = trial[teamA][playerA];
    trial[teamA][playerA] = trial[teamB][playerB];
    trial[teamB][playerB] = temp;

    const newScore = getBalanceScore(trial);
    if (newScore < bestScore) {
      bestTeams = trial;
      bestScore = newScore;
    }
  }

  // Build proposals
  return bestTeams.map((team, i) => ({
    teamName: String.fromCharCode(65 + i), // A, B, C
    bibColor: DEFAULT_COLORS[i] || "Gray",
    players: team,
    avgSkill: getTeamAvg(team),
  }));
}

function getTeamAvg(team: Player[]): number {
  if (team.length === 0) return 0;
  return team.reduce((s, p) => s + p.skill_rating, 0) / team.length;
}

function getBalanceScore(teams: Player[][]): number {
  const avgs = teams.map(getTeamAvg);
  return Math.max(...avgs) - Math.min(...avgs);
}

export function getBalanceScoreFromProposals(proposals: TeamProposal[]): number {
  const avgs = proposals.map((p) => p.avgSkill);
  return Math.max(...avgs) - Math.min(...avgs);
}
