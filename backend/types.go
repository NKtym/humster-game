package main

import (
	"errors"
	"sync"
	"time"
)

type Currency string

const (
	Seeds    Currency = "seeds"
	Wheat    Currency = "wheat"
	Carrot   Currency = "carrot"
	Cucumber Currency = "cucumber"
	Apple    Currency = "apple"
	Kormik   Currency = "kormik"
)

type Item struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	Slot        string           `json:"slot"`
	Cost        map[Currency]int `json:"cost"`
	Stats       map[string]int   `json:"stats"`
	Description string           `json:"description"`
}

type Boss struct {
	ID               string               `json:"id"`
	Name             string               `json:"name"`
	HP               int                  `json:"hp"`
	MaxHP            int                  `json:"maxHp"`
	Attack           int                  `json:"attack"`
	Reward           map[Currency]int     `json:"reward"`
	XP               int                  `json:"xp"`
	Defeated         bool                 `json:"defeated"`
	BattleStartedAt  time.Time            `json:"battleStartedAt"`
	BattleEndsAt     time.Time            `json:"battleEndsAt"`
	AttackCooldowns  map[string]time.Time `json:"attackCooldowns"`
	KillsToday       int                  `json:"killsToday"`
	KillsDay         string               `json:"killsDay"`
	KillsTotal       int                  `json:"killsTotal"`
	BestClearSeconds int                  `json:"bestClearSeconds"`
}

type Business struct {
	ShopLevel        int       `json:"shopLevel"`
	ShopLastClaimAt  time.Time `json:"shopLastClaimAt"`
	WheelLevel       int       `json:"wheelLevel"`
	WheelLastClaimAt time.Time `json:"wheelLastClaimAt"`
}

type AdventureNode struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	EnergyCost     int    `json:"energyCost"`
	RequiredPasses int    `json:"requiredPasses"`
	Progress       int    `json:"progress"`
	Completed      bool   `json:"completed"`
}

type Appearance struct {
	Background string `json:"background"`
	Color      string `json:"color"`
	HeldItem   string `json:"heldItem"`
	Headwear   string `json:"headwear"`
	Glasses    string `json:"glasses"`
	Mask       string `json:"mask"`
	Body       string `json:"body"`
	Shoes      string `json:"shoes"`
}

type Player struct {
	Name                 string            `json:"name"`
	Level                int               `json:"level"`
	XP                   int               `json:"xp"`
	HP                   int               `json:"hp"`
	MaxHP                int               `json:"maxHp"`
	Energy               int               `json:"energy"`
	MaxEnergy            int               `json:"maxEnergy"`
	Attack               int               `json:"attack"`
	Defense              int               `json:"defense"`
	Currency             map[Currency]int  `json:"currency"`
	Inventory            map[string]int    `json:"inventory"`
	Equipped             map[string]string `json:"equipped"`
	Wallpaper            string            `json:"wallpaper"`
	Appearance           Appearance        `json:"appearance"`
	TalentClass          string            `json:"talentClass"`
	TalentPoints         int               `json:"talentPoints"`
	TalentPointsSpent    int               `json:"talentPointsSpent"`
	TalentDamageProgress int               `json:"talentDamageProgress"`
	TalentNextThreshold  int               `json:"talentNextThreshold"`
	Talents              map[string]int    `json:"talents"`
}

type GameState struct {
	Player                  Player           `json:"player"`
	Location                string           `json:"location"`
	Bosses                  []Boss           `json:"bosses"`
	ActiveBossID            string           `json:"activeBossId"`
	Adventure               []AdventureNode  `json:"adventure"`
	ActiveAdventureID       string           `json:"activeAdventureId"`
	Business                Business         `json:"business"`
	BossKillsToday          int              `json:"bossKillsToday"`
	BossKillsDay            string           `json:"bossKillsDay"`
	LocationPasses          int              `json:"locationPasses"`
	BossDamageDay           int              `json:"bossDamageDay"`
	BossDamageDayKey        string           `json:"bossDamageDayKey"`
	BossDamageWeek          int              `json:"bossDamageWeek"`
	BossDamageWeekKey       string           `json:"bossDamageWeekKey"`
	BossDamageMonth         int              `json:"bossDamageMonth"`
	BossDamageMonthKey      string           `json:"bossDamageMonthKey"`
	BossDamageAllTime       int              `json:"bossDamageAllTime"`
	BossBattleDamageCurrent int              `json:"bossBattleDamageCurrent"`
	BossBattleDamageBest    int              `json:"bossBattleDamageBest"`
	EconomyTotals           map[Currency]int `json:"economyTotals"`
	Log                     []string         `json:"log"`
	UpdatedAt               time.Time        `json:"updatedAt"`
	LastEnergyRegenAt       time.Time        `json:"lastEnergyRegenAt"`
}

type Session struct {
	mu    sync.Mutex
	state GameState
}

type Server struct {
	mu        sync.Mutex
	sessions  map[string]*Session
	items     map[string]Item
	dbURL     string
	localPath string
}

type ActionRequest struct {
	Action     string `json:"action"`
	ItemID     string `json:"itemId,omitempty"`
	Name       string `json:"name,omitempty"`
	BossID     string `json:"bossId,omitempty"`
	NodeID     string `json:"nodeId,omitempty"`
	AttackType string `json:"attackType,omitempty"`
	Slot       string `json:"slot,omitempty"`
	Value      string `json:"value,omitempty"`
}

type ActionResponse struct {
	OK    bool      `json:"ok"`
	State GameState `json:"state"`
	Error string    `json:"error,omitempty"`
}

type AuthRequest struct {
	Login    string `json:"login"`
	Password string `json:"password"`
}

type AuthResponse struct {
	OK    bool      `json:"ok"`
	Token string    `json:"token,omitempty"`
	User  string    `json:"user,omitempty"`
	State GameState `json:"state"`
	Error string    `json:"error,omitempty"`
}

type socialFriendSummary struct {
	UserID     string    `json:"userId"`
	Login      string    `json:"login"`
	State      GameState `json:"state"`
	Online     bool      `json:"online"`
	LastSeenAt time.Time `json:"lastSeenAt"`
}

type socialRequestSummary struct {
	UserID     string    `json:"userId"`
	Login      string    `json:"login"`
	State      GameState `json:"state"`
	Online     bool      `json:"online"`
	LastSeenAt time.Time `json:"lastSeenAt"`
}

type socialProfile struct {
	UserID     string                 `json:"userId"`
	Login      string                 `json:"login"`
	State      GameState              `json:"state"`
	Online     bool                   `json:"online"`
	LastSeenAt time.Time              `json:"lastSeenAt"`
	IsSelf     bool                   `json:"isSelf"`
	IsFriend   bool                   `json:"isFriend"`
	Friends    []socialFriendSummary  `json:"friends,omitempty"`
	Requests   []socialRequestSummary `json:"requests,omitempty"`
}

type socialProfileResponse struct {
	OK      bool          `json:"ok"`
	Profile socialProfile `json:"profile"`
	Error   string        `json:"error,omitempty"`
}

type socialMutationResponse struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

type leaderboardEntry struct {
	UserID string `json:"userId"`
	Login  string `json:"login"`
	Damage int    `json:"damage"`
	Place  int    `json:"place"`
}

type leaderboardResponse struct {
	OK           bool                          `json:"ok"`
	Leaderboards map[string][]leaderboardEntry `json:"leaderboards"`
	Error        string                        `json:"error,omitempty"`
}

type leaderboardRewardGrant struct {
	PeriodType  string `json:"periodType"`
	PeriodKey   string `json:"periodKey"`
	WinnerID    string `json:"winnerId"`
	WinnerLogin string `json:"winnerLogin"`
}

type socialFriendRequest struct {
	Login string `json:"login"`
}

type userRecord struct {
	ID    string
	Login string
	Salt  string
	Hash  string
}

type stateLease struct {
	state   *GameState
	release func()
	commit  func() error
}

var errNoRows = errors.New("no rows")

const (
	bossAttackCooldown = 6 * time.Hour
	bossBattleDuration = 8 * time.Hour
)

var adventureBlueprints = []AdventureNode{
	{ID: "stage5", Name: "Бежать по полю", EnergyCost: 1, RequiredPasses: 4},
	{ID: "stage4", Name: "Собирать пшеницу", EnergyCost: 2, RequiredPasses: 4},
	{ID: "stage3", Name: "Собирать орешки для белочки", EnergyCost: 3, RequiredPasses: 5},
	{ID: "stage2", Name: "Делать домик", EnergyCost: 3, RequiredPasses: 6},
	{ID: "stage1", Name: "Строить мост через ручей", EnergyCost: 4, RequiredPasses: 6},
}
