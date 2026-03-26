const offerings = [
  {
    id: 1,
    company: "GreenTech Solar",
    sector: "Clean Energy",
    stage: "Series B",
    minInvestment: 10000,
    valuation: 50000000,
    returnPercentage: 28,
    estimatedExitDate: "2027-06-01",
    risk: "medium",
    liquidity: "low"
  },
  {
    id: 2,
    company: "HealthAI Labs",
    sector: "Healthcare",
    stage: "Series A",
    minInvestment: 5000,
    valuation: 20000000,
    returnPercentage: 45,
    estimatedExitDate: "2026-12-01",
    risk: "high",
    liquidity: "low"
  },
  {
    id: 3,
    company: "FinFlow",
    sector: "Fintech",
    stage: "Series C",
    minInvestment: 25000,
    valuation: 120000000,
    returnPercentage: 18,
    estimatedExitDate: "2026-06-01",
    risk: "low",
    liquidity: "medium"
  },
  {
    id: 4,
    company: "EduSpark",
    sector: "Edtech",
    stage: "Seed",
    minInvestment: 2000,
    valuation: 5000000,
    returnPercentage: 60,
    estimatedExitDate: "2028-01-01",
    risk: "high",
    liquidity: "low"
  },
  {
    id: 5,
    company: "RetailBot",
    sector: "Retail Tech",
    stage: "Series B",
    minInvestment: 15000,
    valuation: 75000000,
    returnPercentage: 22,
    estimatedExitDate: "2027-03-01",
    risk: "medium",
    liquidity: "medium"
  }
];

const userProfile = {
  name: "Demo Investor",
  riskTolerance: "medium",
  preferredSectors: ["Fintech", "Clean Energy"],
  availableCapital: 50000,
  averageReturn: 25
};

module.exports = { offerings, userProfile };