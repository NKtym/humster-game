package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/big"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type Currency string

const (
	Seeds  Currency = "seeds"
	Wheat  Currency = "wheat"
	Carrot Currency = "carrot"
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
	ID       string           `json:"id"`
	Name     string           `json:"name"`
	HP       int              `json:"hp"`
	MaxHP    int              `json:"maxHp"`
	Attack   int              `json:"attack"`
	Reward   map[Currency]int `json:"reward"`
	XP       int              `json:"xp"`
	Defeated bool             `json:"defeated"`
}

type AdventureNode struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	EnergyCost     int    `json:"energyCost"`
	RequiredPasses int    `json:"requiredPasses"`
	Progress       int    `json:"progress"`
	Completed      bool   `json:"completed"`
}

type Player struct {
	Name      string            `json:"name"`
	Level     int               `json:"level"`
	XP        int               `json:"xp"`
	HP        int               `json:"hp"`
	MaxHP     int               `json:"maxHp"`
	Energy    int               `json:"energy"`
	MaxEnergy int               `json:"maxEnergy"`
	Attack    int               `json:"attack"`
	Defense   int               `json:"defense"`
	Currency  map[Currency]int  `json:"currency"`
	Inventory map[string]int    `json:"inventory"`
	Equipped  map[string]string `json:"equipped"`
	Wallpaper string            `json:"wallpaper"`
}

type GameState struct {
	Player            Player          `json:"player"`
	Location          string          `json:"location"`
	Bosses            []Boss          `json:"bosses"`
	ActiveBossID      string          `json:"activeBossId"`
	Adventure         []AdventureNode `json:"adventure"`
	ActiveAdventureID string          `json:"activeAdventureId"`
	Log               []string        `json:"log"`
	UpdatedAt         time.Time       `json:"updatedAt"`
	LastEnergyRegenAt time.Time       `json:"lastEnergyRegenAt"`
}

type Session struct {
	mu    sync.Mutex
	state GameState
}

type Server struct {
	mu       sync.Mutex
	sessions map[string]*Session
	items    map[string]Item
}

type ActionRequest struct {
	Action     string `json:"action"`
	ItemID     string `json:"itemId,omitempty"`
	Name       string `json:"name,omitempty"`
	BossID     string `json:"bossId,omitempty"`
	NodeID     string `json:"nodeId,omitempty"`
	AttackType string `json:"attackType,omitempty"`
}

type ActionResponse struct {
	OK    bool      `json:"ok"`
	State GameState `json:"state"`
	Error string    `json:"error,omitempty"`
}

var adventureBlueprints = []AdventureNode{
	{ID: "stage5", Name: "Бежать по полю", EnergyCost: 1, RequiredPasses: 4},
	{ID: "stage4", Name: "Собирать пшеницу", EnergyCost: 2, RequiredPasses: 4},
	{ID: "stage3", Name: "Собирать орешки для белочки", EnergyCost: 3, RequiredPasses: 5},
	{ID: "stage2", Name: "Делать домик", EnergyCost: 3, RequiredPasses: 6},
	{ID: "stage1", Name: "Строить мост через ручей", EnergyCost: 4, RequiredPasses: 6},
}

func main() {
	srv := newServer()
	mux := http.NewServeMux()

	mux.HandleFunc("/api/state", srv.handleState)
	mux.HandleFunc("/api/action", srv.handleAction)
	mux.HandleFunc("/api/name", srv.handleName)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	port := envOr("PORT", "8080")
	addr := ":" + port

	log.Printf("backend listening on %s", addr)
	if err := http.ListenAndServe(addr, logging(cors(mux))); err != nil {
		log.Fatal(err)
	}
}

func newServer() *Server {
	return &Server{
		sessions: map[string]*Session{},
		items: map[string]Item{
			"straw_cap": {
				ID:          "straw_cap",
				Name:        "Соломенная кепка",
				Slot:        "head",
				Cost:        map[Currency]int{Seeds: 10},
				Stats:       map[string]int{"defense": 1},
				Description: "Лёгкая кепка для храброго хомяка.",
			},
			"grain_cloak": {
				ID:          "grain_cloak",
				Name:        "Зерновой плащ",
				Slot:        "body",
				Cost:        map[Currency]int{Wheat: 8},
				Stats:       map[string]int{"hp": 2, "defense": 1},
				Description: "Плащ из запасов, полезный в поле.",
			},
			"carrot_boots": {
				ID:          "carrot_boots",
				Name:        "Морковные сапожки",
				Slot:        "feet",
				Cost:        map[Currency]int{Carrot: 12},
				Stats:       map[string]int{"energy": 2},
				Description: "Для длинных вылазок по полю.",
			},
			"wallpaper_day": {
				ID:          "wallpaper_day",
				Name:        "Обои: летнее поле",
				Slot:        "wallpaper",
				Cost:        map[Currency]int{},
				Stats:       map[string]int{},
				Description: "Светлые обои с открытым полем и высоким небом.",
			},
			"wallpaper_sunset": {
				ID:          "wallpaper_sunset",
				Name:        "Обои: закатное поле",
				Slot:        "wallpaper",
				Cost:        map[Currency]int{Seeds: 18},
				Stats:       map[string]int{},
				Description: "Тёплые обои для вечерней прогулки хомяка.",
			},
			"wallpaper_night": {
				ID:          "wallpaper_night",
				Name:        "Обои: ночное поле",
				Slot:        "wallpaper",
				Cost:        map[Currency]int{Wheat: 12},
				Stats:       map[string]int{},
				Description: "Тихие ночные обои с глубоким синим тоном.",
			},
		},
	}
}

func (s *Server) handleState(w http.ResponseWriter, r *http.Request) {
	sessionID := sessionIDFromRequest(w, r)
	sess := s.getSession(sessionID)
	writeJSON(w, ActionResponse{OK: true, State: sess.snapshot()})
}

func (s *Server) handleName(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req ActionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, ActionResponse{OK: false, Error: "bad json"})
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeJSON(w, ActionResponse{OK: false, Error: "имя не может быть пустым"})
		return
	}
	if len([]rune(name)) > 20 {
		writeJSON(w, ActionResponse{OK: false, Error: "имя слишком длинное"})
		return
	}

	sessionID := sessionIDFromRequest(w, r)
	sess := s.getSession(sessionID)
	sess.mu.Lock()
	defer sess.mu.Unlock()

	advanceEnergy(&sess.state)
	sess.state.Player.Name = name
	appendLog(&sess.state, fmt.Sprintf("Теперь тебя зовут %s.", name))
	writeJSON(w, ActionResponse{OK: true, State: sess.state})
}

func (s *Server) handleAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req ActionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, ActionResponse{OK: false, Error: "bad json"})
		return
	}

	sessionID := sessionIDFromRequest(w, r)
	sess := s.getSession(sessionID)
	sess.mu.Lock()
	defer sess.mu.Unlock()

	advanceEnergy(&sess.state)
	sess.state.UpdatedAt = time.Now()

	var err error
	switch req.Action {
	case "explore_field":
		err = s.exploreField(&sess.state)
	case "select_boss":
		err = s.selectBoss(&sess.state, req.BossID)
	case "clear_boss":
		err = s.clearBoss(&sess.state)
	case "attack_boss":
		err = s.attackBoss(&sess.state, req.AttackType)
	case "buy_item":
		err = s.buyItem(&sess.state, req.ItemID)
	case "equip_item":
		err = s.equipItem(&sess.state, req.ItemID)
	case "rest":
		err = rest(&sess.state)
	case "select_adventure":
		err = s.selectAdventure(&sess.state, req.NodeID)
	case "adventure_step":
		err = s.adventureStep(&sess.state, req.NodeID)
	case "new_run":
		sess.state = newGameState()
		appendLog(&sess.state, "Новая игра началась.")
	default:
		err = fmt.Errorf("неизвестное действие")
	}

	if err != nil {
		appendLog(&sess.state, err.Error())
		writeJSON(w, ActionResponse{OK: false, Error: err.Error(), State: sess.state})
		return
	}

	writeJSON(w, ActionResponse{OK: true, State: sess.state})
}

func (s *Server) exploreField(gs *GameState) error {
	if gs.Player.Energy <= 0 {
		return fmt.Errorf("не хватает энергии")
	}

	gs.Player.Energy--
	gs.Location = "Поле"

	roll := randInt(100)
	switch {
	case roll < 35:
		gain := 1 + randInt(4)
		currencies := []Currency{Seeds, Wheat, Carrot}
		cur := currencies[randInt(len(currencies))]
		gs.Player.Currency[cur] += gain
		appendLog(gs, fmt.Sprintf("На поле найдено +%d %s.", gain, currencyLabel(cur)))
	case roll < 65:
		appendLog(gs, "На поле шевелится трава — там может быть враг.")
	case roll < 85:
		gs.Player.Currency[Seeds] += 2
		gs.Player.Currency[Wheat] += 1
		appendLog(gs, "Хомяк собрал небольшой урожай.")
	default:
		appendLog(gs, "Поле оказалось пустым, но хомяк не расстроился.")
	}
	return nil
}

func (s *Server) selectBoss(gs *GameState, bossID string) error {
	if bossID == "" {
		gs.ActiveBossID = ""
		appendLog(gs, "Выбор босса закрыт.")
		return nil
	}

	boss, _, ok := currentBoss(gs, bossID)
	if !ok {
		return fmt.Errorf("босс не найден")
	}

	gs.ActiveBossID = bossID
	if boss.Defeated {
		appendLog(gs, fmt.Sprintf("%s уже побеждён. Можно выбрать другого босса.", boss.Name))
	} else {
		appendLog(gs, fmt.Sprintf("Выбран босс: %s.", boss.Name))
	}
	return nil
}

func (s *Server) clearBoss(gs *GameState) error {
	gs.ActiveBossID = ""
	appendLog(gs, "Выбор босса закрыт.")
	return nil
}

func (s *Server) attackBoss(gs *GameState, attackType string) error {
	boss, idx, ok := currentBoss(gs, gs.ActiveBossID)
	if !ok {
		return fmt.Errorf("сначала выбери босса")
	}
	if boss.Defeated {
		return fmt.Errorf("этот босс уже побеждён")
	}

	damage, label, ok := attackConfig(attackType)
	if !ok {
		return fmt.Errorf("неизвестный удар")
	}

	gs.Bosses[idx].HP = max(0, boss.HP-damage)
	appendLog(gs, fmt.Sprintf("Хомяк использовал %s и нанёс %d урона %s.", label, damage, boss.Name))

	if gs.Bosses[idx].HP == 0 {
		gs.Bosses[idx].Defeated = true
		for cur, amount := range gs.Bosses[idx].Reward {
			gs.Player.Currency[cur] += amount
		}
		gs.Player.XP += gs.Bosses[idx].XP
		appendLog(gs, fmt.Sprintf("%s побеждён! Награда получена.", boss.Name))
		recalcLevel(gs)
		if allBossesDefeated(gs) {
			appendLog(gs, "Все боссы побеждены. Можно выбрать нового противника или продолжать качаться на поле.")
		}
		return nil
	}

	counter := max(1, gs.Bosses[idx].Attack+randInt(5)-2-gs.Player.Defense/2)
	gs.Player.HP = max(0, gs.Player.HP-counter)
	appendLog(gs, fmt.Sprintf("%s отвечает и наносит %d урона.", boss.Name, counter))
	if gs.Player.HP == 0 {
		gs.Player.HP = gs.Player.MaxHP
		gs.Player.Energy = gs.Player.MaxEnergy
		appendLog(gs, "Хомяк отступил и пришёл в себя.")
	}
	return nil
}

func (s *Server) selectAdventure(gs *GameState, nodeID string) error {
	if nodeID == "" {
		return fmt.Errorf("точка не найдена")
	}

	idx, ok := adventureIndex(gs, nodeID)
	if !ok {
		return fmt.Errorf("точка не найдена")
	}
	if !adventureSelectable(gs, idx) {
		return fmt.Errorf("следующая точка пока недоступна")
	}

	gs.ActiveAdventureID = nodeID
	appendLog(gs, fmt.Sprintf("Выбрана %s.", gs.Adventure[idx].Name))
	return nil
}

func (s *Server) adventureStep(gs *GameState, nodeID string) error {
	activeID := strings.TrimSpace(nodeID)
	if activeID == "" {
		activeID = gs.ActiveAdventureID
	}
	if activeID == "" {
		return fmt.Errorf("сначала выбери точку")
	}

	idx, ok := adventureIndex(gs, activeID)
	if !ok {
		return fmt.Errorf("точка не найдена")
	}
	if !adventureSelectable(gs, idx) {
		return fmt.Errorf("следующая точка пока недоступна")
	}

	node := gs.Adventure[idx]
	if node.Completed {
		return fmt.Errorf("эта точка уже пройдена")
	}
	if gs.Player.Energy < node.EnergyCost {
		return fmt.Errorf("не хватает энергии")
	}

	gs.Player.Energy -= node.EnergyCost
	gs.Adventure[idx].Progress++
	appendLog(gs, fmt.Sprintf("%s пройден на %d/%d.", node.Name, gs.Adventure[idx].Progress, node.RequiredPasses))

	if gs.Adventure[idx].Progress >= node.RequiredPasses {
		gs.Adventure[idx].Completed = true
		appendLog(gs, fmt.Sprintf("%s полностью пройдена!", node.Name))
		next := firstIncompleteAdventureIndex(gs)
		if next >= 0 {
			gs.ActiveAdventureID = gs.Adventure[next].ID
			appendLog(gs, fmt.Sprintf("Открыта %s.", gs.Adventure[next].Name))
		} else {
			appendLog(gs, "Карта приключений пройдена полностью.")
		}
	}
	return nil
}

func (s *Server) buyItem(gs *GameState, itemID string) error {
	item, ok := s.items[itemID]
	if !ok {
		return fmt.Errorf("предмет не найден")
	}
	if _, owned := gs.Player.Inventory[itemID]; owned {
		return fmt.Errorf("предмет уже куплен")
	}
	if !canAfford(gs.Player.Currency, item.Cost) {
		return fmt.Errorf("не хватает валюты")
	}

	pay(gs.Player.Currency, item.Cost)
	gs.Player.Inventory[itemID] = 1
	applyItemStats(gs, item)
	appendLog(gs, fmt.Sprintf("Куплен предмет: %s.", item.Name))
	return nil
}

func (s *Server) equipItem(gs *GameState, itemID string) error {
	item, ok := s.items[itemID]
	if !ok {
		return fmt.Errorf("предмет не найден")
	}
	if gs.Player.Inventory[itemID] == 0 {
		return fmt.Errorf("предмет нужно купить")
	}

	gs.Player.Equipped[item.Slot] = itemID
	if item.Slot == "wallpaper" {
		gs.Player.Wallpaper = itemID
	}
	appendLog(gs, fmt.Sprintf("Экипирован предмет: %s.", item.Name))
	return nil
}

func rest(gs *GameState) error {
	if gs.Player.Energy >= gs.Player.MaxEnergy {
		return fmt.Errorf("энергия уже полная")
	}
	cost := 2
	if gs.Player.Currency[Seeds] < cost {
		return fmt.Errorf("не хватает семечек для отдыха")
	}
	gs.Player.Currency[Seeds] -= cost
	gs.Player.Energy = min(gs.Player.MaxEnergy, gs.Player.Energy+3)
	appendLog(gs, "Хомяк перекусил семечками и восстановил энергию.")
	return nil
}

func attackConfig(attackType string) (int, string, bool) {
	switch attackType {
	case "belly_punch":
		return 5, "удар пузиком", true
	case "scratch":
		return 20, "царапанье", true
	case "rush":
		return 15, "удар с разбега", true
	case "bite":
		return 30, "укус", true
	default:
		return 0, "", false
	}
}

func applyItemStats(gs *GameState, item Item) {
	for stat, value := range item.Stats {
		switch stat {
		case "hp":
			gs.Player.MaxHP += value
			gs.Player.HP += value
		case "energy":
			gs.Player.MaxEnergy += value
			gs.Player.Energy += value
		case "attack":
			gs.Player.Attack += value
		case "defense":
			gs.Player.Defense += value
		}
	}
}

func recalcLevel(gs *GameState) {
	for gs.Player.XP >= gs.Player.Level*10 {
		need := gs.Player.Level * 10
		gs.Player.XP -= need
		gs.Player.Level++
		gs.Player.MaxHP += 2
		gs.Player.HP = gs.Player.MaxHP
		gs.Player.Attack++
		gs.Player.Defense++
		appendLog(gs, fmt.Sprintf("Уровень повышен! Теперь уровень %d.", gs.Player.Level))
	}
}

func newGameState() GameState {
	return GameState{
		Player: Player{
			Name:      "Хомяк",
			Level:     1,
			XP:        0,
			HP:        10,
			MaxHP:     10,
			Energy:    40,
			MaxEnergy: 40,
			Attack:    2,
			Defense:   0,
			Currency: map[Currency]int{
				Seeds:  10,
				Wheat:  3,
				Carrot: 0,
			},
			Inventory: map[string]int{
				"wallpaper_day": 1,
			},
			Equipped: map[string]string{
				"wallpaper": "wallpaper_day",
			},
			Wallpaper: "wallpaper_day",
		},
		Location: "Поле",
		Bosses: []Boss{
			{
				ID:       "rat",
				Name:     "Крыса",
				HP:       200,
				MaxHP:    200,
				Attack:   4,
				Reward:   map[Currency]int{Seeds: 10, Wheat: 1},
				XP:       10,
				Defeated: false,
			},
			{
				ID:       "lizard",
				Name:     "Ящерица",
				HP:       500,
				MaxHP:    500,
				Attack:   8,
				Reward:   map[Currency]int{Seeds: 30, Wheat: 3},
				XP:       20,
				Defeated: false,
			},
			{
				ID:       "sand_lizard",
				Name:     "Песчаная ящерица",
				HP:       2000,
				MaxHP:    2000,
				Attack:   16,
				Reward:   map[Currency]int{Seeds: 100, Wheat: 10, Carrot: 1},
				XP:       50,
				Defeated: false,
			},
		},
		Adventure:         defaultAdventureNodes(),
		ActiveAdventureID: adventureBlueprints[0].ID,
		ActiveBossID:      "",
		Log:               []string{"Добро пожаловать в поле хомяков."},
		UpdatedAt:         time.Now(),
		LastEnergyRegenAt: time.Now(),
	}
}

func defaultAdventureNodes() []AdventureNode {
	nodes := make([]AdventureNode, len(adventureBlueprints))
	copy(nodes, adventureBlueprints)
	return nodes
}

func adventureIndex(gs *GameState, id string) (int, bool) {
	for i := range gs.Adventure {
		if gs.Adventure[i].ID == id {
			return i, true
		}
	}
	return -1, false
}

func firstIncompleteAdventureIndex(gs *GameState) int {
	for i := range gs.Adventure {
		if !gs.Adventure[i].Completed {
			return i
		}
	}
	return -1
}

func adventureSelectable(gs *GameState, idx int) bool {
	if idx < 0 || idx >= len(gs.Adventure) {
		return false
	}
	unlocked := firstIncompleteAdventureIndex(gs)
	if unlocked < 0 {
		return true
	}
	return idx <= unlocked
}

func currentBoss(gs *GameState, id string) (*Boss, int, bool) {
	for i := range gs.Bosses {
		if gs.Bosses[i].ID == id {
			return &gs.Bosses[i], i, true
		}
	}
	return nil, -1, false
}

func allBossesDefeated(gs *GameState) bool {
	if len(gs.Bosses) == 0 {
		return false
	}
	for i := range gs.Bosses {
		if !gs.Bosses[i].Defeated {
			return false
		}
	}
	return true
}

func advanceEnergy(gs *GameState) {
	now := time.Now()
	if gs.LastEnergyRegenAt.IsZero() {
		gs.LastEnergyRegenAt = now
	}
	if gs.Player.MaxEnergy <= 0 {
		gs.Player.Energy = 0
		gs.LastEnergyRegenAt = now
		return
	}
	if gs.Player.Energy >= gs.Player.MaxEnergy {
		gs.Player.Energy = gs.Player.MaxEnergy
		gs.LastEnergyRegenAt = now
		return
	}

	elapsed := now.Sub(gs.LastEnergyRegenAt)
	if elapsed < 4*time.Minute {
		return
	}
	gained := int(elapsed / (4 * time.Minute))
	if gained <= 0 {
		return
	}
	missing := gs.Player.MaxEnergy - gs.Player.Energy
	if gained > missing {
		gained = missing
	}
	gs.Player.Energy += gained
	gs.LastEnergyRegenAt = gs.LastEnergyRegenAt.Add(time.Duration(gained) * 4 * time.Minute)
	if gs.Player.Energy >= gs.Player.MaxEnergy {
		gs.Player.Energy = gs.Player.MaxEnergy
		gs.LastEnergyRegenAt = now
	}
}

func (s *Server) getSession(sessionID string) *Session {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sessions == nil {
		s.sessions = map[string]*Session{}
	}
	if sess, ok := s.sessions[sessionID]; ok {
		return sess
	}
	sess := &Session{state: newGameState()}
	appendLog(&sess.state, "Новая сессия создана.")
	s.sessions[sessionID] = sess
	return sess
}

func (s *Session) snapshot() GameState {
	s.mu.Lock()
	defer s.mu.Unlock()
	advanceEnergy(&s.state)
	return copyState(s.state)
}

func copyState(gs GameState) GameState {
	cp := gs
	cp.Player.Currency = copyCurrency(gs.Player.Currency)
	cp.Player.Inventory = copyInventory(gs.Player.Inventory)
	cp.Player.Equipped = copyEquipped(gs.Player.Equipped)
	cp.Bosses = copyBosses(gs.Bosses)
	cp.Adventure = copyAdventure(gs.Adventure)
	cp.Log = append([]string(nil), gs.Log...)
	return cp
}

func copyAdventure(in []AdventureNode) []AdventureNode {
	out := make([]AdventureNode, len(in))
	copy(out, in)
	return out
}

func copyBosses(in []Boss) []Boss {
	out := make([]Boss, len(in))
	for i, boss := range in {
		out[i] = boss
		out[i].Reward = copyCurrency(boss.Reward)
	}
	return out
}

func copyCurrency(in map[Currency]int) map[Currency]int {
	out := make(map[Currency]int, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func copyInventory(in map[string]int) map[string]int {
	out := make(map[string]int, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func copyEquipped(in map[string]string) map[string]string {
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func appendLog(gs *GameState, line string) {
	gs.Log = append([]string{line}, gs.Log...)
	if len(gs.Log) > 20 {
		gs.Log = gs.Log[:20]
	}
}

func canAfford(balance map[Currency]int, cost map[Currency]int) bool {
	for cur, amt := range cost {
		if balance[cur] < amt {
			return false
		}
	}
	return true
}

func pay(balance map[Currency]int, cost map[Currency]int) {
	for cur, amt := range cost {
		balance[cur] -= amt
	}
}

func currencyLabel(cur Currency) string {
	switch cur {
	case Seeds:
		return "семечек"
	case Wheat:
		return "пшеницы"
	case Carrot:
		return "моркови"
	default:
		return string(cur)
	}
}

func sessionIDFromRequest(w http.ResponseWriter, r *http.Request) string {
	sid := strings.TrimSpace(r.Header.Get("X-Game-Session"))
	if sid == "" {
		sid = randomID()
		w.Header().Set("X-Game-Session", sid)
	}
	return sid
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Game-Session")
		w.Header().Set("Access-Control-Expose-Headers", "X-Game-Session")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(v)
}

func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Truncate(time.Millisecond))
	})
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func randomID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

func randInt(n int) int {
	if n <= 0 {
		return 0
	}
	x, err := rand.Int(rand.Reader, big.NewInt(int64(n)))
	if err != nil {
		return int(time.Now().UnixNano() % int64(n))
	}
	return int(x.Int64())
}

func max(a, b int) int {
	return int(math.Max(float64(a), float64(b)))
}

func min(a, b int) int {
	return int(math.Min(float64(a), float64(b)))
}
