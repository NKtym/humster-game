package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"math/big"
	"net/http"
	"os"
	"os/exec"
	"strings"
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
	ID              string               `json:"id"`
	Name            string               `json:"name"`
	HP              int                  `json:"hp"`
	MaxHP           int                  `json:"maxHp"`
	Attack          int                  `json:"attack"`
	Reward          map[Currency]int     `json:"reward"`
	XP              int                  `json:"xp"`
	Defeated        bool                 `json:"defeated"`
	BattleStartedAt time.Time            `json:"battleStartedAt"`
	BattleEndsAt    time.Time            `json:"battleEndsAt"`
	AttackCooldowns map[string]time.Time `json:"attackCooldowns"`
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
	Name       string            `json:"name"`
	Level      int               `json:"level"`
	XP         int               `json:"xp"`
	HP         int               `json:"hp"`
	MaxHP      int               `json:"maxHp"`
	Energy     int               `json:"energy"`
	MaxEnergy  int               `json:"maxEnergy"`
	Attack     int               `json:"attack"`
	Defense    int               `json:"defense"`
	Currency   map[Currency]int  `json:"currency"`
	Inventory  map[string]int    `json:"inventory"`
	Equipped   map[string]string `json:"equipped"`
	Wallpaper  string            `json:"wallpaper"`
	Appearance Appearance        `json:"appearance"`
}

type GameState struct {
	Player            Player          `json:"player"`
	Location          string          `json:"location"`
	Bosses            []Boss          `json:"bosses"`
	ActiveBossID      string          `json:"activeBossId"`
	Adventure         []AdventureNode `json:"adventure"`
	ActiveAdventureID string          `json:"activeAdventureId"`
	BossKillsToday    int             `json:"bossKillsToday"`
	BossKillsDay      string          `json:"bossKillsDay"`
	Log               []string        `json:"log"`
	UpdatedAt         time.Time       `json:"updatedAt"`
	LastEnergyRegenAt time.Time       `json:"lastEnergyRegenAt"`
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

func main() {
	srv := newServer()
	mux := http.NewServeMux()

	mux.HandleFunc("/api/state", srv.handleState)
	mux.HandleFunc("/api/action", srv.handleAction)
	mux.HandleFunc("/api/name", srv.handleName)
	mux.HandleFunc("/api/auth/register", srv.handleRegister)
	mux.HandleFunc("/api/auth/login", srv.handleLogin)
	mux.HandleFunc("/api/auth/me", srv.handleMe)
	mux.HandleFunc("/api/auth/logout", srv.handleLogout)
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
	srv := &Server{
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

	dbURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dbURL == "" {
		log.Println("DATABASE_URL is not set; game progress will stay in memory until a database is configured.")
		return srv
	}

	srv.dbURL = dbURL
	if err := srv.ensureSchema(); err != nil {
		log.Printf("postgres init failed: %v", err)
		srv.dbURL = ""
	}
	return srv
}

func (s *Server) handleState(w http.ResponseWriter, r *http.Request) {
	lease, err := s.leaseState(w, r)
	if err != nil {
		writeJSON(w, ActionResponse{OK: false, Error: err.Error()})
		return
	}
	defer lease.release()

	advanceEnergy(lease.state)
	advanceBossTimers(lease.state)
	if err := lease.commit(); err != nil {
		writeJSON(w, ActionResponse{OK: false, Error: err.Error()})
		return
	}
	writeJSON(w, ActionResponse{OK: true, State: copyState(*lease.state)})
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

	lease, err := s.leaseState(w, r)
	if err != nil {
		writeJSON(w, ActionResponse{OK: false, Error: err.Error()})
		return
	}
	defer lease.release()

	advanceEnergy(lease.state)
	advanceBossTimers(lease.state)
	lease.state.Player.Name = name
	appendLog(lease.state, fmt.Sprintf("Теперь тебя зовут %s.", name))

	if err := lease.commit(); err != nil {
		writeJSON(w, ActionResponse{OK: false, Error: err.Error()})
		return
	}
	writeJSON(w, ActionResponse{OK: true, State: copyState(*lease.state)})
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

	lease, err := s.leaseState(w, r)
	if err != nil {
		writeJSON(w, ActionResponse{OK: false, Error: err.Error()})
		return
	}
	defer lease.release()

	advanceEnergy(lease.state)
	advanceBossTimers(lease.state)
	lease.state.UpdatedAt = time.Now()

	switch req.Action {
	case "explore_field":
		err = s.exploreField(lease.state)
	case "select_boss":
		err = s.selectBoss(lease.state, req.BossID)
	case "clear_boss":
		err = s.clearBoss(lease.state)
	case "attack_boss":
		err = s.attackBoss(lease.state, req.AttackType)
	case "buy_item":
		err = s.buyItem(lease.state, req.ItemID)
	case "equip_item":
		err = s.equipItem(lease.state, req.ItemID)
	case "rest":
		err = rest(lease.state)
	case "select_adventure":
		err = s.selectAdventure(lease.state, req.NodeID)
	case "adventure_step":
		err = s.adventureStep(lease.state, req.NodeID)
	case "new_run":
		*lease.state = newGameState()
		appendLog(lease.state, "Новая игра началась.")
	case "set_appearance":
		err = s.setAppearance(lease.state, req.Slot, req.Value)
	default:
		err = fmt.Errorf("неизвестное действие")
	}

	if err != nil {
		appendLog(lease.state, err.Error())
		if commitErr := lease.commit(); commitErr != nil {
			writeJSON(w, ActionResponse{OK: false, Error: commitErr.Error(), State: copyState(*lease.state)})
			return
		}
		writeJSON(w, ActionResponse{OK: false, Error: err.Error(), State: copyState(*lease.state)})
		return
	}

	if err := lease.commit(); err != nil {
		writeJSON(w, ActionResponse{OK: false, Error: err.Error(), State: copyState(*lease.state)})
		return
	}
	writeJSON(w, ActionResponse{OK: true, State: copyState(*lease.state)})
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req AuthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, AuthResponse{OK: false, Error: "bad json"})
		return
	}
	login := normalizeLogin(req.Login)
	password := strings.TrimSpace(req.Password)
	if err := validateCredentials(login, password); err != nil {
		writeJSON(w, AuthResponse{OK: false, Error: err.Error()})
		return
	}

	ctx := context.Background()
	exists, err := s.userByLogin(ctx, login)
	if err != nil && !errors.Is(err, errNoRows) {
		writeJSON(w, AuthResponse{OK: false, Error: "не удалось проверить логин"})
		return
	}
	if exists != nil {
		writeJSON(w, AuthResponse{OK: false, Error: "такой логин уже занят"})
		return
	}

	salt := randomID()
	hash := passwordHash(password, salt)
	userID := randomID()
	if strings.TrimSpace(s.dbURL) == "" {
		if err := s.withLocalStore(func(store *localStore) error {
			store.ensure()
			for _, u := range store.Users {
				if u.Login == login {
					return fmt.Errorf("такой логин уже занят")
				}
			}
			store.Users[userID] = userRecord{ID: userID, Login: login, Salt: salt, Hash: hash}
			return nil
		}); err != nil {
			writeJSON(w, AuthResponse{OK: false, Error: err.Error()})
			return
		}
	} else if err := s.execPSQL(ctx, `INSERT INTO users (id, login, password_salt, password_hash) VALUES (:'id', :'login', :'salt', :'hash')`, map[string]string{"id": userID, "login": login, "salt": salt, "hash": hash}); err != nil {
		writeJSON(w, AuthResponse{OK: false, Error: "не удалось создать пользователя"})
		return
	}

	state := newGameState()
	state.Player.Name = login
	if err := s.saveState(ctx, userID, state); err != nil {
		writeJSON(w, AuthResponse{OK: false, Error: "не удалось сохранить прогресс"})
		return
	}

	token, err := s.createSession(ctx, userID)
	if err != nil {
		writeJSON(w, AuthResponse{OK: false, Error: "не удалось создать сессию"})
		return
	}

	writeJSON(w, AuthResponse{OK: true, Token: token, User: login, State: copyState(state)})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req AuthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, AuthResponse{OK: false, Error: "bad json"})
		return
	}
	login := normalizeLogin(req.Login)
	password := strings.TrimSpace(req.Password)
	if err := validateCredentials(login, password); err != nil {
		writeJSON(w, AuthResponse{OK: false, Error: err.Error()})
		return
	}

	ctx := context.Background()
	user, err := s.userByLogin(ctx, login)
	if err != nil {
		writeJSON(w, AuthResponse{OK: false, Error: "неверный логин или пароль"})
		return
	}
	if !verifyPassword(password, user.Salt, user.Hash) {
		writeJSON(w, AuthResponse{OK: false, Error: "неверный логин или пароль"})
		return
	}

	state, err := s.loadState(ctx, user.ID)
	if err != nil {
		writeJSON(w, AuthResponse{OK: false, Error: "не удалось загрузить прогресс"})
		return
	}
	if state.Player.Name == "" {
		state.Player.Name = login
	}
	if err := s.saveState(ctx, user.ID, state); err != nil {
		writeJSON(w, AuthResponse{OK: false, Error: "не удалось сохранить прогресс"})
		return
	}

	token, err := s.createSession(ctx, user.ID)
	if err != nil {
		writeJSON(w, AuthResponse{OK: false, Error: "не удалось создать сессию"})
		return
	}

	writeJSON(w, AuthResponse{OK: true, Token: token, User: login, State: copyState(state)})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := s.userIDFromRequest(r)
	if !ok {
		writeJSON(w, AuthResponse{OK: false, Error: "не авторизован"})
		return
	}
	ctx := context.Background()
	login, err := s.loginByUserID(ctx, userID)
	if err != nil {
		writeJSON(w, AuthResponse{OK: false, Error: "не авторизован"})
		return
	}
	state, err := s.loadState(ctx, userID)
	if err != nil {
		writeJSON(w, AuthResponse{OK: false, Error: "не удалось загрузить прогресс"})
		return
	}
	writeJSON(w, AuthResponse{OK: true, User: login, State: copyState(state)})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	token := requestAuthToken(r)
	if token == "" {
		writeJSON(w, AuthResponse{OK: true})
		return
	}
	if strings.TrimSpace(s.dbURL) == "" {
		_ = s.withLocalStore(func(store *localStore) error {
			delete(store.Sessions, sessionTokenHash(token))
			return nil
		})
		writeJSON(w, AuthResponse{OK: true})
		return
	}
	_ = s.execPSQL(context.Background(), `DELETE FROM auth_sessions WHERE token_hash = :'token_hash'`, map[string]string{
		"token_hash": sessionTokenHash(token),
	})
	writeJSON(w, AuthResponse{OK: true})
}

func (s *Server) leaseState(w http.ResponseWriter, r *http.Request) (*stateLease, error) {
	if userID, ok := s.userIDFromRequest(r); ok {
		ctx := context.Background()
		state, err := s.loadState(ctx, userID)
		if err != nil {
			return nil, err
		}
		return &stateLease{
			state:   &state,
			release: func() {},
			commit: func() error {
				return s.saveState(ctx, userID, state)
			},
		}, nil
	}

	sid := sessionIDFromRequest(w, r)
	sess := s.getSession(sid)
	sess.mu.Lock()
	return &stateLease{
		state:   &sess.state,
		release: func() { sess.mu.Unlock() },
		commit:  func() error { return nil },
	}, nil
}

func (s *Server) userIDFromRequest(r *http.Request) (string, bool) {
	token := requestAuthToken(r)
	if token == "" {
		return "", false
	}
	if strings.TrimSpace(s.dbURL) == "" {
		userID, ok := s.localUserIDForToken(token)
		if !ok {
			return "", false
		}
		return userID, true
	}
	ctx := context.Background()
	out, err := s.queryPSQL(ctx, `
		SELECT user_id
		FROM auth_sessions
		WHERE token_hash = :'token_hash' AND expires_at > NOW()
		LIMIT 1
	`, map[string]string{
		"token_hash": sessionTokenHash(token),
	})
	if err != nil {
		return "", false
	}
	userID := strings.TrimSpace(out)
	if userID == "" {
		return "", false
	}
	return userID, true
}

func requestAuthToken(r *http.Request) string {
	token := strings.TrimSpace(r.Header.Get("X-Auth-Token"))
	if token != "" {
		return token
	}
	if auth := strings.TrimSpace(r.Header.Get("Authorization")); strings.HasPrefix(strings.ToLower(auth), "bearer ") {
		return strings.TrimSpace(auth[7:])
	}
	if c, err := r.Cookie("humster_auth"); err == nil {
		return strings.TrimSpace(c.Value)
	}
	return ""
}

func normalizeLogin(login string) string {
	return strings.ToLower(strings.TrimSpace(login))
}

func validateCredentials(login, password string) error {
	if len([]rune(login)) < 3 {
		return fmt.Errorf("логин должен быть не короче 3 символов")
	}
	if len([]rune(login)) > 32 {
		return fmt.Errorf("логин слишком длинный")
	}
	if len([]rune(password)) < 6 {
		return fmt.Errorf("пароль должен быть не короче 6 символов")
	}
	if len([]rune(password)) > 72 {
		return fmt.Errorf("пароль слишком длинный")
	}
	return nil
}

func passwordHash(password, salt string) string {
	sum := sha256.Sum256([]byte(salt + ":" + password))
	return hex.EncodeToString(sum[:])
}

func verifyPassword(password, salt, hash string) bool {
	candidate := passwordHash(password, salt)
	return subtle.ConstantTimeCompare([]byte(candidate), []byte(hash)) == 1
}

func sessionTokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (s *Server) createSession(ctx context.Context, userID string) (string, error) {
	token := randomID() + randomID()
	if strings.TrimSpace(s.dbURL) == "" {
		if err := s.withLocalStore(func(store *localStore) error {
			store.ensure()
			store.Sessions[sessionTokenHash(token)] = localSessionRecord{
				UserID:    userID,
				ExpiresAt: time.Now().Add(30 * 24 * time.Hour).UTC(),
			}
			return nil
		}); err != nil {
			return "", err
		}
		return token, nil
	}
	expiresAt := time.Now().Add(30 * 24 * time.Hour).UTC().Format(time.RFC3339Nano)
	return token, s.execPSQL(ctx, `
		INSERT INTO auth_sessions (token_hash, user_id, expires_at)
		VALUES (:'token_hash', :'user_id', :'expires_at'::timestamptz)
	`, map[string]string{
		"token_hash": sessionTokenHash(token),
		"user_id":    userID,
		"expires_at": expiresAt,
	})
}

func (s *Server) ensureSchema() error {
	if strings.TrimSpace(s.dbURL) == "" {
		return s.withLocalStore(func(store *localStore) error {
			store.ensure()
			return nil
		})
	}
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			login TEXT NOT NULL UNIQUE,
			password_salt TEXT NOT NULL,
			password_hash TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS game_states (
			user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			state_json JSONB NOT NULL,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS auth_sessions (
			token_hash TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			expires_at TIMESTAMPTZ NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at)`,
	}
	for _, stmt := range stmts {
		if err := s.execPSQL(context.Background(), stmt, nil); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) userByLogin(ctx context.Context, login string) (*userRecord, error) {
	if strings.TrimSpace(s.dbURL) == "" {
		var found *userRecord
		err := s.withLocalStore(func(store *localStore) error {
			store.ensure()
			for _, u := range store.Users {
				if u.Login == login {
					copy := u
					found = &copy
					return nil
				}
			}
			return errNoRows
		})
		if err != nil {
			return nil, err
		}
		if found == nil {
			return nil, errNoRows
		}
		return found, nil
	}
	out, err := s.queryPSQL(ctx, `
		SELECT id, login, password_salt, password_hash
		FROM users
		WHERE login = :'login'
		LIMIT 1
	`, map[string]string{"login": login})
	if err != nil {
		return nil, err
	}
	out = strings.TrimSpace(out)
	if out == "" {
		return nil, errNoRows
	}
	parts := strings.SplitN(out, "	", 4)
	if len(parts) != 4 {
		return nil, fmt.Errorf("неожиданный ответ базы данных")
	}
	return &userRecord{
		ID:    parts[0],
		Login: parts[1],
		Salt:  parts[2],
		Hash:  parts[3],
	}, nil
}

func (s *Server) loginByUserID(ctx context.Context, userID string) (string, error) {
	if strings.TrimSpace(s.dbURL) == "" {
		var login string
		err := s.withLocalStore(func(store *localStore) error {
			store.ensure()
			for _, u := range store.Users {
				if u.ID == userID {
					login = u.Login
					return nil
				}
			}
			return errNoRows
		})
		if err != nil {
			return "", err
		}
		if strings.TrimSpace(login) == "" {
			return "", errNoRows
		}
		return login, nil
	}
	out, err := s.queryPSQL(ctx, `
		SELECT login
		FROM users
		WHERE id = :'user_id'
		LIMIT 1
	`, map[string]string{"user_id": userID})
	if err != nil {
		return "", err
	}
	login := strings.TrimSpace(out)
	if login == "" {
		return "", errNoRows
	}
	return login, nil
}

func (s *Server) loadState(ctx context.Context, userID string) (GameState, error) {
	if strings.TrimSpace(s.dbURL) == "" {
		var state GameState
		err := s.withLocalStore(func(store *localStore) error {
			store.ensure()
			if existing, ok := store.States[userID]; ok {
				state = existing
				return nil
			}
			state = newGameState()
			store.States[userID] = copyState(state)
			return nil
		})
		if err != nil {
			return GameState{}, err
		}
		if state.Player.Currency == nil {
			state.Player.Currency = map[Currency]int{}
		}
		if state.Player.Inventory == nil {
			state.Player.Inventory = map[string]int{}
		}
		if state.Player.Equipped == nil {
			state.Player.Equipped = map[string]string{}
		}
		if state.Player.Appearance == (Appearance{}) {
			state.Player.Appearance = newGameState().Player.Appearance
		}
		refreshBossKillLimit(&state)
		normalizeBosses(&state)
		advanceBossTimers(&state)
		return state, nil
	}
	out, err := s.queryPSQL(ctx, `
		SELECT state_json::text
		FROM game_states
		WHERE user_id = :'user_id'
		LIMIT 1
	`, map[string]string{"user_id": userID})
	if err != nil {
		return GameState{}, err
	}
	raw := strings.TrimSpace(out)
	if raw == "" {
		state := newGameState()
		if err := s.saveState(ctx, userID, state); err != nil {
			return GameState{}, err
		}
		return state, nil
	}
	var state GameState
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		return GameState{}, err
	}
	if state.Player.Currency == nil {
		state.Player.Currency = map[Currency]int{}
	}
	if state.Player.Inventory == nil {
		state.Player.Inventory = map[string]int{}
	}
	if state.Player.Equipped == nil {
		state.Player.Equipped = map[string]string{}
	}
	if state.Player.Appearance == (Appearance{}) {
		state.Player.Appearance = newGameState().Player.Appearance
	}
	refreshBossKillLimit(&state)
	normalizeBosses(&state)
	advanceBossTimers(&state)
	return state, nil
}

func (s *Server) saveState(ctx context.Context, userID string, state GameState) error {
	if strings.TrimSpace(s.dbURL) == "" {
		return s.withLocalStore(func(store *localStore) error {
			store.ensure()
			store.States[userID] = copyState(state)
			return nil
		})
	}
	payload, err := json.Marshal(state)
	if err != nil {
		return err
	}
	return s.execPSQL(ctx, `
		INSERT INTO game_states (user_id, state_json, updated_at)
		VALUES (:'user_id', :'state_json'::jsonb, NOW())
		ON CONFLICT (user_id)
		DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = NOW()
	`, map[string]string{
		"user_id":    userID,
		"state_json": string(payload),
	})
}

func (s *Server) queryPSQL(ctx context.Context, query string, vars map[string]string) (string, error) {
	if strings.TrimSpace(s.dbURL) == "" {
		return "", fmt.Errorf("база данных не подключена")
	}
	args := []string{
		s.dbURL,
		"-X",
		"-v", "ON_ERROR_STOP=1",
		"-Atq",
		"-F", "	",
	}
	for k, v := range vars {
		esc := strings.ReplaceAll(v, "'", "''")
		query = strings.ReplaceAll(query, ":'"+k+"'", "'"+esc+"'")
	}
	args = append(args, "-c", query)
	cmd := exec.CommandContext(ctx, "psql", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg != "" {
			return "", fmt.Errorf(msg)
		}
		return "", err
	}
	return string(out), nil
}

func (s *Server) execPSQL(ctx context.Context, query string, vars map[string]string) error {
	_, err := s.queryPSQL(ctx, query, vars)
	return err
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
		currencies := []Currency{Seeds, Wheat, Carrot, Cucumber, Apple, Kormik}
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

	now := time.Now()
	if !boss.Defeated {
		startBossBattle(boss, now)
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
	refreshBossKillLimit(gs)
	advanceBossTimers(gs)

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

	now := time.Now()
	if boss.BattleEndsAt.IsZero() {
		startBossBattle(&gs.Bosses[idx], now)
		boss = &gs.Bosses[idx]
	}
	if !boss.BattleEndsAt.IsZero() && now.After(boss.BattleEndsAt) {
		advanceBossTimers(gs)
		boss, idx, ok = currentBoss(gs, gs.ActiveBossID)
		if !ok {
			return fmt.Errorf("битва уже завершилась по таймеру")
		}
		if boss.Defeated {
			return fmt.Errorf("этот босс уже побеждён")
		}
	}
	if boss.AttackCooldowns == nil {
		boss.AttackCooldowns = map[string]time.Time{}
	}
	if until, ok := boss.AttackCooldowns[attackType]; ok && now.Before(until) {
		return fmt.Errorf("удар %s ещё перезаряжается", label)
	}

	if boss.HP-damage <= 0 && gs.BossKillsToday >= 8 {
		return fmt.Errorf("дневной лимит убийств боссов достигнут: 8/8")
	}

	gs.Bosses[idx].HP = max(0, boss.HP-damage)
	gs.Bosses[idx].AttackCooldowns[attackType] = now.Add(bossAttackCooldown)
	appendLog(gs, fmt.Sprintf("Хомяк использовал %s и нанёс %d урона %s.", label, damage, boss.Name))

	if gs.Bosses[idx].HP == 0 {
		gs.Bosses[idx].Defeated = true
		gs.BossKillsToday++
		gs.BossKillsDay = bossKillDayKey()
		gs.Bosses[idx].BattleStartedAt = time.Time{}
		gs.Bosses[idx].BattleEndsAt = time.Time{}
		gs.Bosses[idx].AttackCooldowns = map[string]time.Time{}
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
	xpGain, seedGain := adventureRewardForIndex(idx)
	if xpGain > 0 || seedGain > 0 {
		gs.Player.XP += xpGain
		gs.Player.Currency[Seeds] += seedGain
		appendLog(gs, fmt.Sprintf("Награда за действие: +%d опыта и +%d семечек.", xpGain, seedGain))
		recalcLevel(gs)
	}
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

func (s *Server) setAppearance(gs *GameState, slot, value string) error {
	slot = strings.TrimSpace(slot)
	value = strings.TrimSpace(value)
	if slot == "" {
		return fmt.Errorf("неизвестный слот")
	}
	if value == "" {
		return fmt.Errorf("значение не выбрано")
	}

	switch slot {
	case "background":
		gs.Player.Appearance.Background = value
		gs.Player.Wallpaper = value
	case "color":
		gs.Player.Appearance.Color = value
	case "heldItem":
		gs.Player.Appearance.HeldItem = value
	case "headwear":
		gs.Player.Appearance.Headwear = value
	case "glasses":
		gs.Player.Appearance.Glasses = value
	case "mask":
		gs.Player.Appearance.Mask = value
	case "body":
		gs.Player.Appearance.Body = value
	case "shoes":
		gs.Player.Appearance.Shoes = value
	default:
		return fmt.Errorf("неизвестный слот")
	}
	appendLog(gs, fmt.Sprintf("Хомяк изменил внешний вид: %s.", slot))
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
	for gs.Player.XP >= xpForNextLevel(gs.Player.Level) {
		need := xpForNextLevel(gs.Player.Level)
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
				Seeds:    10,
				Wheat:    3,
				Carrot:   0,
				Cucumber: 0,
				Apple:    0,
				Kormik:   0,
			},
			Inventory: map[string]int{
				"wallpaper_day": 1,
			},
			Equipped: map[string]string{
				"wallpaper": "wallpaper_day",
			},
			Wallpaper: "wallpaper_day",
			Appearance: Appearance{
				Background: "wallpaper_day",
				Color:      "default",
				HeldItem:   "none",
				Headwear:   "none",
				Glasses:    "none",
				Mask:       "none",
				Body:       "none",
				Shoes:      "none",
			},
		},
		Location: "Поле",
		Bosses: []Boss{
			{
				ID:              "rat",
				Name:            "Крыса",
				HP:              70,
				MaxHP:           70,
				Attack:          4,
				Reward:          map[Currency]int{Seeds: 10, Wheat: 2, Carrot: 1, Cucumber: 0},
				XP:              10,
				Defeated:        false,
				AttackCooldowns: map[string]time.Time{},
			},
			{
				ID:              "lizard",
				Name:            "Ящерица",
				HP:              150,
				MaxHP:           150,
				Attack:          8,
				Reward:          map[Currency]int{Seeds: 50, Wheat: 3, Carrot: 0, Cucumber: 1},
				XP:              20,
				Defeated:        false,
				AttackCooldowns: map[string]time.Time{},
			},
			{
				ID:              "sand_lizard",
				Name:            "Песчаная ящерица",
				HP:              600,
				MaxHP:           600,
				Attack:          16,
				Reward:          map[Currency]int{Seeds: 200, Wheat: 0, Carrot: 3, Cucumber: 1},
				XP:              50,
				Defeated:        false,
				AttackCooldowns: map[string]time.Time{},
			},
		},
		Adventure:         defaultAdventureNodes(),
		ActiveAdventureID: adventureBlueprints[0].ID,
		ActiveBossID:      "",
		BossKillsToday:    0,
		BossKillsDay:      bossKillDayKey(),
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

func adventureRewardForIndex(idx int) (int, int) {
	switch idx {
	case 0:
		return 1, 2
	case 1:
		return 1, 3
	case 2:
		return 2, 5
	case 3:
		return 3, 6
	case 4:
		return 3, 10
	default:
		return 0, 0
	}
}

func refreshBossKillLimit(gs *GameState) {
	day := bossKillDayKey()
	if gs.BossKillsDay != day {
		gs.BossKillsDay = day
		gs.BossKillsToday = 0
	}
	if gs.BossKillsToday < 0 {
		gs.BossKillsToday = 0
	}
	if gs.BossKillsToday > 8 {
		gs.BossKillsToday = 8
	}
}

func normalizeBosses(gs *GameState) {
	type bossTemplate struct {
		name   string
		hp     int
		attack int
		xp     int
		reward map[Currency]int
	}
	templates := map[string]bossTemplate{
		"rat":         {name: "Крыса", hp: 70, attack: 4, xp: 10, reward: map[Currency]int{Seeds: 10, Wheat: 2, Carrot: 1, Cucumber: 0}},
		"lizard":      {name: "Ящерица", hp: 150, attack: 8, xp: 20, reward: map[Currency]int{Seeds: 50, Wheat: 3, Carrot: 0, Cucumber: 1}},
		"sand_lizard": {name: "Песчаная ящерица", hp: 600, attack: 16, xp: 50, reward: map[Currency]int{Seeds: 200, Wheat: 0, Carrot: 3, Cucumber: 1}},
	}
	for i := range gs.Bosses {
		boss := &gs.Bosses[i]
		if tpl, ok := templates[boss.ID]; ok {
			if boss.Name == "" {
				boss.Name = tpl.name
			}
			if boss.MaxHP <= 0 {
				boss.MaxHP = tpl.hp
			}
			if boss.Attack <= 0 {
				boss.Attack = tpl.attack
			}
			if boss.XP <= 0 {
				boss.XP = tpl.xp
			}
			if boss.Reward == nil {
				boss.Reward = map[Currency]int{}
			}
			for cur, amount := range tpl.reward {
				boss.Reward[cur] = amount
			}
			if boss.AttackCooldowns == nil {
				boss.AttackCooldowns = map[string]time.Time{}
			}
			if boss.HP < 0 {
				boss.HP = 0
			}
			if boss.HP > boss.MaxHP {
				boss.HP = boss.MaxHP
			}
			if boss.Defeated {
				boss.HP = 0
				boss.BattleStartedAt = time.Time{}
				boss.BattleEndsAt = time.Time{}
				boss.AttackCooldowns = map[string]time.Time{}
			}
		}
	}
}

func startBossBattle(boss *Boss, now time.Time) {
	if boss == nil || boss.Defeated {
		return
	}
	if boss.AttackCooldowns == nil {
		boss.AttackCooldowns = map[string]time.Time{}
	}
	if boss.BattleStartedAt.IsZero() || boss.BattleEndsAt.IsZero() || now.After(boss.BattleEndsAt) {
		boss.BattleStartedAt = now
		boss.BattleEndsAt = now.Add(bossBattleDuration)
	}
}

func resetBossBattle(boss *Boss) {
	if boss == nil {
		return
	}
	boss.BattleStartedAt = time.Time{}
	boss.BattleEndsAt = time.Time{}
	boss.AttackCooldowns = map[string]time.Time{}
}

func advanceBossTimers(gs *GameState) {
	now := time.Now()
	for i := range gs.Bosses {
		boss := &gs.Bosses[i]
		if boss.AttackCooldowns == nil {
			boss.AttackCooldowns = map[string]time.Time{}
		}
		if boss.Defeated {
			resetBossBattle(boss)
			continue
		}
		if !boss.BattleEndsAt.IsZero() && now.After(boss.BattleEndsAt) {
			appendLog(gs, fmt.Sprintf("Битва с %s завершилась поражением по таймеру.", boss.Name))
			boss.HP = boss.MaxHP
			resetBossBattle(boss)
			if gs.ActiveBossID == boss.ID {
				gs.ActiveBossID = ""
			}
			continue
		}
		if boss.BattleStartedAt.IsZero() && !boss.BattleEndsAt.IsZero() {
			boss.BattleStartedAt = now.Add(-bossBattleDuration + time.Minute)
		}
	}
}

func bossKillDayKey() string {
	return time.Now().In(gameLocation()).Format("2006-01-02")
}

var (
	gameLocationOnce  sync.Once
	gameLocationValue *time.Location
)

func gameLocation() *time.Location {
	gameLocationOnce.Do(func() {
		loc, err := time.LoadLocation("Europe/Amsterdam")
		if err != nil {
			gameLocationValue = time.Local
			return
		}
		gameLocationValue = loc
	})
	if gameLocationValue == nil {
		return time.Local
	}
	return gameLocationValue
}

func xpForNextLevel(level int) int {
	if level < 1 {
		level = 1
	}
	return 10 * (1 << uint(level-1))
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
	refreshBossKillLimit(gs)
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
	advanceBossTimers(&s.state)
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
		if boss.AttackCooldowns != nil {
			out[i].AttackCooldowns = make(map[string]time.Time, len(boss.AttackCooldowns))
			for k, v := range boss.AttackCooldowns {
				out[i].AttackCooldowns[k] = v
			}
		}
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
	case Cucumber:
		return "огурцов"
	case Apple:
		return "яблок"
	case Kormik:
		return "кормика"
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
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Game-Session, X-Auth-Token, Authorization")
		w.Header().Set("Access-Control-Expose-Headers", "X-Game-Session, X-Auth-Token")
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
