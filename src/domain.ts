export interface DateRange {
  start: string;
  end: string;
}

export interface HardConstraints {
  budgetCNY?: number;
  dateRange?: DateRange;
  travelers?: number;
  departure?: string;
  destination?: string;
}

export interface SoftPreferences {
  pace?: 'relaxed' | 'balanced' | 'packed';
  cuisinePrefs?: string[];
  hotelTier?: 'budget' | 'midrange' | 'luxury';
  avoidChains?: boolean;
  interests?: string[];
  notes?: string;
}

export interface TripConstraints {
  hard: HardConstraints;
  soft: SoftPreferences;
}

export interface CostBreakdown {
  flightsCNY?: number;
  hotelsCNY?: number;
  transitCNY?: number;
  foodCNY?: number;
  activitiesCNY?: number;
  totalCNY: number;
}

export interface ItineraryItem {
  time?: string;
  title: string;
  location?: string;
  estCostCNY?: number;
  notes?: string;
  kind?: 'spot' | 'transport' | 'hotel' | 'food' | 'activity' | 'other';
  status?: 'pending' | 'confirmed';
}

export interface DayPlan {
  date: string;
  city: string;
  items: ItineraryItem[];
  estCostCNY?: number;
}

export interface Itinerary {
  version: number;
  days: DayPlan[];
  totalCost?: CostBreakdown;
  notes?: string;
}

export interface TripWorkspaceProfile {
  departure?: string;
  destination?: string;
  dateRange?: DateRange;
  budgetCNY?: number;
  travelers?: number;
  pace?: 'relaxed' | 'balanced' | 'packed';
  hotelTier?: 'budget' | 'midrange' | 'luxury';
}

export interface TripWorkspace {
  version: number;
  profile: TripWorkspaceProfile;
  itinerary: Itinerary;
  pendingQuestions?: string[];
  manualFields?: string[];
  updatedAt?: string;
}

export interface ValidationIssue {
  severity: 'error' | 'warn';
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}
