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
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	businessUnlockLevel = 12
	businessCycle       = 12 * time.Hour
)

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
	mux.HandleFunc("/api/social/profile", srv.handleSocialProfile)
	mux.HandleFunc("/api/social/friends/add", srv.handleSocialFriendAdd)
	mux.HandleFunc("/api/social/friends/remove", srv.handleSocialFriendRemove)
	mux.HandleFunc("/api/social/friends/requests/accept", srv.handleSocialFriendRequestAccept)
	mux.HandleFunc("/api/social/friends/requests/decline", srv.handleSocialFriendRequestDecline)
	mux.HandleFunc("/api/leaderboards", srv.handleLeaderboards)
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
	const maxInitAttempts = 30
	var lastErr error
	for attempt := 1; attempt <= maxInitAttempts; attempt++ {
		if err := srv.ensureSchema(); err != nil {
			lastErr = err
			log.Printf("postgres init attempt %d/%d failed: %v", attempt, maxInitAttempts, err)
			time.Sleep(2 * time.Second)
			continue
		}
		lastErr = nil
		break
	}
	if lastErr != nil {
		log.Printf("postgres init failed after retries; switching to local storage: %v", lastErr)
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
	advanceBusiness(lease.state)
	advanceBossTimers(lease.state)
	if err := lease.commit(); err != nil {
		writeJSON(w, ActionResponse{OK: false, Error: err.Error()})
		return
	}
	_ = s.processLeaderboardRewards(context.Background())
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
	advanceBusiness(lease.state)
	advanceBossTimers(lease.state)
	lease.state.Player.Name = name
	appendLog(lease.state, fmt.Sprintf("Теперь тебя зовут %s.", name))

	if err := lease.commit(); err != nil {
		writeJSON(w, ActionResponse{OK: false, Error: err.Error()})
		return
	}
	_ = s.processLeaderboardRewards(context.Background())
	writeJSON(w, ActionResponse{OK: true, State: copyState(*lease.state)})
}

func (s *Server) handleAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req ActionRequest
	userID, _ := s.userIDFromRequest(r)
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
	advanceBusiness(lease.state)
	advanceBossTimers(lease.state)
	lease.state.UpdatedAt = time.Now()

	switch req.Action {
	case "explore_field":
		err = s.exploreField(lease.state)
	case "select_boss":
		err = s.selectBoss(lease.state, req.BossID)
	case "clear_boss":
		err = s.clearBoss(lease.state)
	case "finish_battle":
		err = s.finishBossBattle(lease.state)
	case "retry_boss":
		err = s.retryBoss(lease.state)
	case "attack_boss":
		err = s.attackBoss(lease.state, req.AttackType, userID)
	case "buy_attack":
		err = s.buyAttack(lease.state, req.AttackType)
	case "buy_item":
		err = s.buyItem(lease.state, req.ItemID)
	case "buy_business_shop":
		err = s.buyBusiness(lease.state, "shop")
	case "buy_business_wheel":
		err = s.buyBusiness(lease.state, "wheel")
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
	case "select_talent_class":
		err = s.selectTalentClass(lease.state, req.Value)
	case "buy_talent":
		err = s.buyTalentRank(lease.state, req.Slot)
	case "exchange_currency":
		err = s.exchangeCurrency(lease.state, req.From, req.To)
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

func (s *Server) handleSocialProfile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	login := normalizeLogin(r.URL.Query().Get("login"))
	if login == "" {
		writeJSON(w, socialProfileResponse{OK: false, Error: "логин не может быть пустым"})
		return
	}
	requesterID, _ := s.userIDFromRequest(r)
	profile, err := s.socialProfileByLogin(context.Background(), login, requesterID)
	if err != nil {
		writeJSON(w, socialProfileResponse{OK: false, Error: err.Error()})
		return
	}
	writeJSON(w, socialProfileResponse{OK: true, Profile: *profile})
}

func (s *Server) handleSocialFriendAdd(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req socialFriendRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, socialMutationResponse{OK: false, Error: "bad json"})
		return
	}
	login := normalizeLogin(req.Login)
	if login == "" {
		writeJSON(w, socialMutationResponse{OK: false, Error: "логин не может быть пустым"})
		return
	}
	requesterID, ok := s.userIDFromRequest(r)
	if !ok {
		writeJSON(w, socialMutationResponse{OK: false, Error: "не авторизован"})
		return
	}
	ctx := context.Background()
	target, err := s.userByLogin(ctx, login)
	if err != nil {
		writeJSON(w, socialMutationResponse{OK: false, Error: "пользователь не найден"})
		return
	}
	if target.ID == requesterID {
		writeJSON(w, socialMutationResponse{OK: false, Error: "нельзя добавить себя в друзья"})
		return
	}
	if err := s.addFriendRequest(ctx, requesterID, target.ID); err != nil {
		writeJSON(w, socialMutationResponse{OK: false, Error: err.Error()})
		return
	}
	writeJSON(w, socialMutationResponse{OK: true})
}

func (s *Server) handleSocialFriendRemove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req socialFriendRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, socialMutationResponse{OK: false, Error: "bad json"})
		return
	}
	login := normalizeLogin(req.Login)
	if login == "" {
		writeJSON(w, socialMutationResponse{OK: false, Error: "логин не может быть пустым"})
		return
	}
	requesterID, ok := s.userIDFromRequest(r)
	if !ok {
		writeJSON(w, socialMutationResponse{OK: false, Error: "не авторизован"})
		return
	}
	ctx := context.Background()
	target, err := s.userByLogin(ctx, login)
	if err != nil {
		writeJSON(w, socialMutationResponse{OK: false, Error: "пользователь не найден"})
		return
	}
	if target.ID == requesterID {
		writeJSON(w, socialMutationResponse{OK: false, Error: "нельзя удалить себя из друзей"})
		return
	}
	if err := s.removeFriendship(ctx, requesterID, target.ID); err != nil {
		writeJSON(w, socialMutationResponse{OK: false, Error: err.Error()})
		return
	}
	writeJSON(w, socialMutationResponse{OK: true})
}

func (s *Server) handleSocialFriendRequestAccept(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req socialFriendRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, socialMutationResponse{OK: false, Error: "bad json"})
		return
	}
	login := normalizeLogin(req.Login)
	if login == "" {
		writeJSON(w, socialMutationResponse{OK: false, Error: "логин не может быть пустым"})
		return
	}
	requesterID, ok := s.userIDFromRequest(r)
	if !ok {
		writeJSON(w, socialMutationResponse{OK: false, Error: "не авторизован"})
		return
	}
	ctx := context.Background()
	target, err := s.userByLogin(ctx, login)
	if err != nil {
		writeJSON(w, socialMutationResponse{OK: false, Error: "пользователь не найден"})
		return
	}
	if target.ID == requesterID {
		writeJSON(w, socialMutationResponse{OK: false, Error: "нельзя добавить себя в друзья"})
		return
	}
	if !s.hasIncomingRequest(ctx, requesterID, target.ID) && !s.areFriends(ctx, requesterID, target.ID) {
		writeJSON(w, socialMutationResponse{OK: false, Error: "заявка не найдена"})
		return
	}
	if err := s.addFriendship(ctx, requesterID, target.ID); err != nil {
		writeJSON(w, socialMutationResponse{OK: false, Error: err.Error()})
		return
	}
	writeJSON(w, socialMutationResponse{OK: true})
}

func (s *Server) handleSocialFriendRequestDecline(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req socialFriendRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, socialMutationResponse{OK: false, Error: "bad json"})
		return
	}
	login := normalizeLogin(req.Login)
	if login == "" {
		writeJSON(w, socialMutationResponse{OK: false, Error: "логин не может быть пустым"})
		return
	}
	requesterID, ok := s.userIDFromRequest(r)
	if !ok {
		writeJSON(w, socialMutationResponse{OK: false, Error: "не авторизован"})
		return
	}
	ctx := context.Background()
	target, err := s.userByLogin(ctx, login)
	if err != nil {
		writeJSON(w, socialMutationResponse{OK: false, Error: "пользователь не найден"})
		return
	}
	if target.ID == requesterID {
		writeJSON(w, socialMutationResponse{OK: false, Error: "нельзя отклонить себя"})
		return
	}
	if err := s.removeFriendRequest(ctx, target.ID, requesterID); err != nil {
		writeJSON(w, socialMutationResponse{OK: false, Error: err.Error()})
		return
	}
	writeJSON(w, socialMutationResponse{OK: true})
}

func (s *Server) handleLeaderboards(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx := context.Background()
	if err := s.processLeaderboardRewards(ctx); err != nil {
		log.Printf("leaderboard rewards processing failed: %v", err)
	}
	leaderboards := map[string][]leaderboardEntry{}
	periods := []string{"day", "week", "month"}
	for _, period := range periods {
		entries, err := s.leaderboardEntries(ctx, period, currentLeaderboardPeriodKey(period, time.Now()), 10)
		if err != nil {
			writeJSON(w, leaderboardResponse{OK: false, Error: err.Error()})
			return
		}
		leaderboards[period] = entries
	}
	writeJSON(w, leaderboardResponse{OK: true, Leaderboards: leaderboards})
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
		`CREATE TABLE IF NOT EXISTS user_friendships (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (user_id, friend_id)
		)`,
		`CREATE TABLE IF NOT EXISTS user_friend_requests (
			requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (requester_id, target_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at)`,
		`CREATE INDEX IF NOT EXISTS idx_user_friendships_friend_id ON user_friendships(friend_id)`,
		`CREATE TABLE IF NOT EXISTS leaderboard_damage_stats (
			period_type TEXT NOT NULL,
			period_key TEXT NOT NULL,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			damage_total BIGINT NOT NULL DEFAULT 0,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (period_type, period_key, user_id)
		)`,
		`CREATE TABLE IF NOT EXISTS leaderboard_reward_grants (
			period_type TEXT NOT NULL,
			period_key TEXT NOT NULL,
			winner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			winner_login TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (period_type, period_key)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_leaderboard_damage_stats_period ON leaderboard_damage_stats(period_type, period_key, damage_total DESC)`,
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

func normalizeOnlineStatus(lastSeen time.Time) bool {
	if lastSeen.IsZero() {
		return false
	}
	now := time.Now().UTC()
	seen := lastSeen.UTC()
	delta := now.Sub(seen)
	return delta >= 0 && delta <= 5*time.Minute
}

func containsString(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}

func uniqueSortedStrings(values []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func addUniqueString(values []string, needle string) []string {
	needle = strings.TrimSpace(needle)
	if needle == "" {
		return uniqueSortedStrings(values)
	}
	for _, value := range values {
		if value == needle {
			return uniqueSortedStrings(values)
		}
	}
	values = append(values, needle)
	return uniqueSortedStrings(values)
}

func removeString(values []string, needle string) []string {
	needle = strings.TrimSpace(needle)
	if needle == "" {
		return uniqueSortedStrings(values)
	}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value != needle {
			out = append(out, value)
		}
	}
	return uniqueSortedStrings(out)
}

func (s *Server) friendRequestIDs(ctx context.Context, userID string) ([]string, error) {
	if strings.TrimSpace(s.dbURL) == "" {
		var ids []string
		err := s.withLocalStore(func(store *localStore) error {
			store.ensure()
			ids = append(ids, store.FriendRequests[userID]...)
			return nil
		})
		if err != nil {
			return nil, err
		}
		return uniqueSortedStrings(ids), nil
	}
	out, err := s.queryPSQL(ctx, `
		SELECT requester_id
		FROM user_friend_requests
		WHERE target_id = :'target_id'
		ORDER BY created_at ASC, requester_id ASC
	`, map[string]string{"target_id": userID})
	if err != nil {
		return nil, err
	}
	rows := strings.Split(strings.TrimSpace(out), "\n")
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		row = strings.TrimSpace(row)
		if row != "" {
			ids = append(ids, row)
		}
	}
	return uniqueSortedStrings(ids), nil
}

func (s *Server) hasIncomingRequest(ctx context.Context, targetID, requesterID string) bool {
	ids, err := s.friendRequestIDs(ctx, targetID)
	if err != nil {
		return false
	}
	return containsString(ids, requesterID)
}

func (s *Server) addFriendRequest(ctx context.Context, requesterID, targetID string) error {
	if strings.TrimSpace(requesterID) == "" || strings.TrimSpace(targetID) == "" {
		return fmt.Errorf("неверные данные")
	}
	if requesterID == targetID {
		return fmt.Errorf("нельзя добавить себя в друзья")
	}
	if s.areFriends(ctx, requesterID, targetID) {
		return nil
	}
	if s.hasIncomingRequest(ctx, requesterID, targetID) {
		return s.addFriendship(ctx, requesterID, targetID)
	}
	if strings.TrimSpace(s.dbURL) == "" {
		return s.withLocalStore(func(store *localStore) error {
			store.ensure()
			store.FriendRequests[targetID] = addUniqueString(store.FriendRequests[targetID], requesterID)
			return nil
		})
	}
	return s.execPSQL(ctx, `
		INSERT INTO user_friend_requests (requester_id, target_id)
		VALUES (:'requester_id', :'target_id')
		ON CONFLICT DO NOTHING
	`, map[string]string{
		"requester_id": requesterID,
		"target_id":    targetID,
	})
}

func (s *Server) removeFriendRequest(ctx context.Context, requesterID, targetID string) error {
	if strings.TrimSpace(requesterID) == "" || strings.TrimSpace(targetID) == "" {
		return fmt.Errorf("неверные данные")
	}
	if requesterID == targetID {
		return fmt.Errorf("нельзя удалить себя")
	}
	if strings.TrimSpace(s.dbURL) == "" {
		return s.withLocalStore(func(store *localStore) error {
			store.ensure()
			store.FriendRequests[targetID] = removeString(store.FriendRequests[targetID], requesterID)
			return nil
		})
	}
	return s.execPSQL(ctx, `
		DELETE FROM user_friend_requests
		WHERE requester_id = :'requester_id' AND target_id = :'target_id'
	`, map[string]string{
		"requester_id": requesterID,
		"target_id":    targetID,
	})
}

func (s *Server) clearFriendRequests(ctx context.Context, userID, friendID string) error {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(friendID) == "" {
		return nil
	}
	if strings.TrimSpace(s.dbURL) == "" {
		return s.withLocalStore(func(store *localStore) error {
			store.ensure()
			store.FriendRequests[friendID] = removeString(store.FriendRequests[friendID], userID)
			store.FriendRequests[userID] = removeString(store.FriendRequests[userID], friendID)
			return nil
		})
	}
	return s.execPSQL(ctx, `
		DELETE FROM user_friend_requests
		WHERE (requester_id = :'user_id' AND target_id = :'friend_id')
		   OR (requester_id = :'friend_id' AND target_id = :'user_id')
	`, map[string]string{
		"user_id":   userID,
		"friend_id": friendID,
	})
}

func (s *Server) friendIDs(ctx context.Context, userID string) ([]string, error) {
	if strings.TrimSpace(s.dbURL) == "" {
		var ids []string
		err := s.withLocalStore(func(store *localStore) error {
			store.ensure()
			ids = append(ids, store.Friends[userID]...)
			return nil
		})
		if err != nil {
			return nil, err
		}
		return uniqueSortedStrings(ids), nil
	}
	out, err := s.queryPSQL(ctx, `
		SELECT friend_id
		FROM user_friendships
		WHERE user_id = :'user_id'
		ORDER BY created_at ASC, friend_id ASC
	`, map[string]string{"user_id": userID})
	if err != nil {
		return nil, err
	}
	rows := strings.Split(strings.TrimSpace(out), "\n")
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		row = strings.TrimSpace(row)
		if row != "" {
			ids = append(ids, row)
		}
	}
	return uniqueSortedStrings(ids), nil
}

func (s *Server) areFriends(ctx context.Context, userID, friendID string) bool {
	ids, err := s.friendIDs(ctx, userID)
	if err != nil {
		return false
	}
	return containsString(ids, friendID)
}

func (s *Server) addFriendship(ctx context.Context, userID, friendID string) error {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(friendID) == "" {
		return fmt.Errorf("неверные данные")
	}
	if userID == friendID {
		return fmt.Errorf("нельзя добавить себя в друзья")
	}
	if strings.TrimSpace(s.dbURL) == "" {
		return s.withLocalStore(func(store *localStore) error {
			store.ensure()
			store.Friends[userID] = addUniqueString(store.Friends[userID], friendID)
			store.Friends[friendID] = addUniqueString(store.Friends[friendID], userID)
			store.FriendRequests[userID] = removeString(store.FriendRequests[userID], friendID)
			store.FriendRequests[friendID] = removeString(store.FriendRequests[friendID], userID)
			return nil
		})
	}
	if err := s.execPSQL(ctx, `
		INSERT INTO user_friendships (user_id, friend_id)
		VALUES (:'user_id', :'friend_id'), (:'friend_id', :'user_id')
		ON CONFLICT DO NOTHING
	`, map[string]string{
		"user_id":   userID,
		"friend_id": friendID,
	}); err != nil {
		return err
	}
	return s.clearFriendRequests(ctx, userID, friendID)
}

func (s *Server) removeFriendship(ctx context.Context, userID, friendID string) error {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(friendID) == "" {
		return fmt.Errorf("неверные данные")
	}
	if userID == friendID {
		return fmt.Errorf("нельзя удалить себя из друзей")
	}
	if strings.TrimSpace(s.dbURL) == "" {
		return s.withLocalStore(func(store *localStore) error {
			store.ensure()
			store.Friends[userID] = removeString(store.Friends[userID], friendID)
			store.Friends[friendID] = removeString(store.Friends[friendID], userID)
			return nil
		})
	}
	return s.execPSQL(ctx, `
		DELETE FROM user_friendships
		WHERE (user_id = :'user_id' AND friend_id = :'friend_id')
		   OR (user_id = :'friend_id' AND friend_id = :'user_id')
	`, map[string]string{
		"user_id":   userID,
		"friend_id": friendID,
	})
}

func (s *Server) socialProfileByLogin(ctx context.Context, login string, requesterID string) (*socialProfile, error) {
	user, err := s.userByLogin(ctx, login)
	if err != nil {
		return nil, fmt.Errorf("пользователь не найден")
	}
	state, err := s.loadState(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	profile := &socialProfile{
		UserID:     user.ID,
		Login:      user.Login,
		State:      copyState(state),
		Online:     normalizeOnlineStatus(state.UpdatedAt),
		LastSeenAt: state.UpdatedAt,
		IsSelf:     strings.TrimSpace(requesterID) != "" && requesterID == user.ID,
		IsFriend:   strings.TrimSpace(requesterID) != "" && requesterID == user.ID,
	}
	if requesterID != "" && requesterID != user.ID {
		profile.IsFriend = s.areFriends(ctx, requesterID, user.ID)
	}
	if profile.IsSelf {
		friendIDs, err := s.friendIDs(ctx, user.ID)
		if err == nil {
			profile.Friends = make([]socialFriendSummary, 0, len(friendIDs))
			for _, friendID := range friendIDs {
				if friendID == user.ID {
					continue
				}
				friendLogin, err := s.loginByUserID(ctx, friendID)
				if err != nil || strings.TrimSpace(friendLogin) == "" {
					continue
				}
				friendState, err := s.loadState(ctx, friendID)
				if err != nil {
					continue
				}
				profile.Friends = append(profile.Friends, socialFriendSummary{
					UserID:     friendID,
					Login:      friendLogin,
					State:      copyState(friendState),
					Online:     normalizeOnlineStatus(friendState.UpdatedAt),
					LastSeenAt: friendState.UpdatedAt,
				})
			}
			sort.Slice(profile.Friends, func(i, j int) bool {
				return strings.ToLower(profile.Friends[i].Login) < strings.ToLower(profile.Friends[j].Login)
			})
		}
		requesterIDs, err := s.friendRequestIDs(ctx, user.ID)
		if err == nil {
			profile.Requests = make([]socialRequestSummary, 0, len(requesterIDs))
			for _, requesterID := range requesterIDs {
				if requesterID == user.ID {
					continue
				}
				requesterLogin, err := s.loginByUserID(ctx, requesterID)
				if err != nil || strings.TrimSpace(requesterLogin) == "" {
					continue
				}
				requesterState, err := s.loadState(ctx, requesterID)
				if err != nil {
					continue
				}
				profile.Requests = append(profile.Requests, socialRequestSummary{
					UserID:     requesterID,
					Login:      requesterLogin,
					State:      copyState(requesterState),
					Online:     normalizeOnlineStatus(requesterState.UpdatedAt),
					LastSeenAt: requesterState.UpdatedAt,
				})
			}
			sort.Slice(profile.Requests, func(i, j int) bool {
				return strings.ToLower(profile.Requests[i].Login) < strings.ToLower(profile.Requests[j].Login)
			})
		}
	}
	return profile, nil
}

func normalizeGameState(state *GameState) {
	if state == nil {
		return
	}
	defaults := newGameState()
	if state.Player.Name == "" {
		state.Player.Name = defaults.Player.Name
	}
	if state.Player.Level < 1 {
		state.Player.Level = defaults.Player.Level
	}
	if state.Player.XP < 0 {
		state.Player.XP = 0
	}
	if state.Player.HP <= 0 {
		state.Player.HP = defaults.Player.HP
	}
	if state.Player.MaxHP <= 0 {
		state.Player.MaxHP = defaults.Player.MaxHP
	}
	if state.Player.Energy < 0 {
		state.Player.Energy = defaults.Player.Energy
	}
	if state.Player.MaxEnergy <= 0 {
		state.Player.MaxEnergy = defaults.Player.MaxEnergy
	}
	if state.Player.Attack < 0 {
		state.Player.Attack = defaults.Player.Attack
	}
	if state.Player.Defense < 0 {
		state.Player.Defense = defaults.Player.Defense
	}
	if state.Business.ShopLevel < 0 {
		state.Business.ShopLevel = 0
	}
	if state.Business.ShopLevel > 100 {
		state.Business.ShopLevel = 100
	}
	if state.Business.WheelLevel < 0 {
		state.Business.WheelLevel = 0
	}
	if state.Business.WheelLevel > 100 {
		state.Business.WheelLevel = 100
	}
	if state.Player.Currency == nil {
		state.Player.Currency = map[Currency]int{}
	}
	for cur, amount := range defaults.Player.Currency {
		if _, ok := state.Player.Currency[cur]; !ok {
			state.Player.Currency[cur] = amount
		}
	}
	if state.EconomyTotals == nil {
		state.EconomyTotals = map[Currency]int{}
	}
	for cur := range defaults.Player.Currency {
		if _, ok := state.EconomyTotals[cur]; !ok {
			state.EconomyTotals[cur] = 0
		}
	}
	if state.Player.Inventory == nil {
		state.Player.Inventory = map[string]int{}
	}
	for k, v := range defaults.Player.Inventory {
		if _, ok := state.Player.Inventory[k]; !ok {
			state.Player.Inventory[k] = v
		}
	}
	if state.Player.Equipped == nil {
		state.Player.Equipped = map[string]string{}
	}
	for k, v := range defaults.Player.Equipped {
		if _, ok := state.Player.Equipped[k]; !ok {
			state.Player.Equipped[k] = v
		}
	}
	if state.Player.Appearance == (Appearance{}) {
		state.Player.Appearance = defaults.Player.Appearance
	}
	if state.Player.Talents == nil {
		state.Player.Talents = map[string]int{}
	}
	if state.Player.TalentClass != "" && !talentClassExists(state.Player.TalentClass) {
		state.Player.TalentClass = ""
	}
	if state.Player.TalentPoints < 0 {
		state.Player.TalentPoints = 0
	}
	if state.Player.TalentPointsSpent < 0 {
		state.Player.TalentPointsSpent = 0
	}
	if state.Player.TalentDamageProgress < 0 {
		state.Player.TalentDamageProgress = 0
	}
	if state.Player.TalentNextThreshold < 70 {
		state.Player.TalentNextThreshold = 70
	}
	if state.Location == "" {
		state.Location = defaults.Location
	}
	if state.LocationPasses < 0 {
		state.LocationPasses = 0
	}
	normalizeBossDamageStats(state)
	if len(state.Bosses) == 0 {
		state.Bosses = newGameState().Bosses
	}
	normalizeBosses(state)
	if len(state.Adventure) == 0 {
		state.Adventure = defaultAdventureNodes()
	}
	if adventureFinished(state) {
		resetAdventureLoop(state)
	}
	if state.ActiveAdventureID == "" {
		state.ActiveAdventureID = defaults.ActiveAdventureID
	}
	if state.Log == nil || len(state.Log) == 0 {
		state.Log = defaults.Log
	}
	if state.UpdatedAt.IsZero() {
		state.UpdatedAt = time.Now()
	}
	if state.LastEnergyRegenAt.IsZero() {
		state.LastEnergyRegenAt = time.Now()
	}
	if state.ActiveBossID != "" {
		if boss, _, ok := currentBoss(state, state.ActiveBossID); !ok || boss == nil {
			state.ActiveBossID = ""
		}
	}
	advanceBossTimers(state)
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
		normalizeGameState(&state)
		_ = s.saveState(ctx, userID, state)
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
	normalizeGameState(&state)
	_ = s.saveState(ctx, userID, state)
	return state, nil
}

func (s *Server) saveState(ctx context.Context, userID string, state GameState) error {
	normalizeGameState(&state)
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
		addCurrencyGain(gs, cur, gain)
		appendLog(gs, fmt.Sprintf("На поле найдено +%d %s.", gain, currencyLabel(cur)))
	case roll < 65:
		appendLog(gs, "На поле шевелится трава — там может быть враг.")
	case roll < 85:
		addCurrencyGain(gs, Seeds, 2)
		addCurrencyGain(gs, Wheat, 1)
		appendLog(gs, "Хомяк собрал небольшой урожай.")
	default:
		appendLog(gs, "Поле оказалось пустым, но хомяк не расстроился.")
	}
	return nil
}

func (s *Server) selectBoss(gs *GameState, bossID string) error {
	if bossID == "" {
		return s.clearBoss(gs)
	}

	if gs.ActiveBossID != "" && gs.ActiveBossID != bossID {
		if active, _, ok := currentBoss(gs, gs.ActiveBossID); ok && active != nil && !active.Defeated && (active.BattleEndsAt.IsZero() || time.Now().Before(active.BattleEndsAt)) {
			return fmt.Errorf("сначала заверши текущую битву с %s", active.Name)
		}
		return fmt.Errorf("сначала заверши текущую битву")
	}

	boss, _, ok := currentBoss(gs, bossID)
	if !ok {
		return fmt.Errorf("босс не найден")
	}
	if bossLockedByProgress(gs, bossID) {
		return fmt.Errorf("этот босс откроется после 1 полного прохождения поля")
	}

	now := time.Now()
	refreshBossKillLimit(boss)
	if boss.Defeated {
		if boss.KillsToday >= 8 {
			return fmt.Errorf("дневной лимит этого босса уже исчерпан")
		}
		prepareBossBattle(boss, now)
		resetBossBattleDamage(gs)
		appendLog(gs, fmt.Sprintf("%s можно пройти ещё раз.", boss.Name))
	} else {
		startBossBattle(boss, now)
		resetBossBattleDamage(gs)
		appendLog(gs, fmt.Sprintf("Выбран босс: %s.", boss.Name))
	}
	gs.ActiveBossID = bossID
	return nil
}

func (s *Server) clearBoss(gs *GameState) error {
	if gs == nil {
		return fmt.Errorf("игровое состояние недоступно")
	}

	boss, _, ok := currentBoss(gs, gs.ActiveBossID)
	if ok && boss != nil && !boss.Defeated && (boss.BattleEndsAt.IsZero() || time.Now().Before(boss.BattleEndsAt)) {
		return fmt.Errorf("сначала заверши текущую битву")
	}

	resetBossBattleDamage(gs)
	gs.ActiveBossID = ""
	appendLog(gs, "Выбор босса закрыт.")
	return nil
}

func (s *Server) finishBossBattle(gs *GameState) error {
	if gs == nil {
		return fmt.Errorf("игровое состояние недоступно")
	}

	boss, idx, ok := currentBoss(gs, gs.ActiveBossID)
	if !ok {
		return fmt.Errorf("сначала выбери босса")
	}

	now := time.Now()
	refreshBossKillLimit(boss)
	if boss.Defeated || (!boss.BattleEndsAt.IsZero() && !now.Before(boss.BattleEndsAt)) {
		return s.clearBoss(gs)
	}

	if gs.Player.Currency[Kormik] < 1 {
		return fmt.Errorf("если хочешь завершить битву раньше, нужно заплатить 1 кормик")
	}

	gs.Player.Currency[Kormik]--
	gs.Bosses[idx].HP = gs.Bosses[idx].MaxHP
	resetBossBattle(&gs.Bosses[idx])
	resetBossBattleDamage(gs)
	gs.ActiveBossID = ""
	appendLog(gs, fmt.Sprintf("Битва с %s завершена за 1 кормик.", boss.Name))
	return nil
}

func (s *Server) retryBoss(gs *GameState) error {
	if gs == nil {
		return fmt.Errorf("игровое состояние недоступно")
	}

	boss, idx, ok := currentBoss(gs, gs.ActiveBossID)
	if !ok {
		return fmt.Errorf("сначала выбери босса")
	}

	refreshBossKillLimit(boss)
	if boss.KillsToday >= 8 {
		return fmt.Errorf("дневной лимит этого босса уже исчерпан")
	}

	if boss.Defeated || boss.HP <= 0 || boss.BattleStartedAt.IsZero() || boss.BattleEndsAt.IsZero() {
		prepareBossBattle(&gs.Bosses[idx], time.Now())
		resetBossBattleDamage(gs)
		appendLog(gs, fmt.Sprintf("%s можно пройти ещё раз.", boss.Name))
		return nil
	}

	return fmt.Errorf("сначала победи босса")
}

func finalizeBossVictory(gs *GameState, idx int, now time.Time) {
	if gs == nil || idx < 0 || idx >= len(gs.Bosses) {
		return
	}
	boss := &gs.Bosses[idx]
	if !boss.BattleStartedAt.IsZero() {
		clearSeconds := int(now.Sub(boss.BattleStartedAt).Seconds())
		if clearSeconds > 0 && (boss.BestClearSeconds <= 0 || clearSeconds < boss.BestClearSeconds) {
			boss.BestClearSeconds = clearSeconds
		}
	}
	boss.Defeated = true
	boss.HP = 0
	boss.KillsToday++
	boss.KillsTotal++
	boss.KillsDay = bossKillDayKey()
	boss.BattleStartedAt = time.Time{}
	boss.BattleEndsAt = time.Time{}
	boss.AttackCooldowns = map[string]time.Time{}
	for cur, amount := range boss.Reward {
		addCurrencyGain(gs, cur, amount)
	}
	gs.Player.XP += boss.XP
	if drop := maybeGrantBossCosmeticDrop(gs, boss); drop != "" {
		appendLog(gs, fmt.Sprintf("Случайная награда: получен %s.", drop))
		appendLog(gs, cosmeticDropBonusText(boss.ID))
	}
	appendLog(gs, fmt.Sprintf("%s побеждён! Награда получена.", boss.Name))
	recalcLevel(gs)
	if boss.KillsToday < 8 {
		appendLog(gs, fmt.Sprintf("%s можно пройти ещё раз. Осталось %d из 8 проходов на сегодня.", boss.Name, 8-boss.KillsToday))
	} else {
		appendLog(gs, fmt.Sprintf("Дневной лимит %s исчерпан.", boss.Name))
	}
	if gs.ActiveBossID == boss.ID {
		resetBossBattleDamage(gs)
		gs.ActiveBossID = ""
	}
	if allBossesDefeated(gs) {
		appendLog(gs, "Все боссы побеждены. Можно выбрать нового противника или продолжать качаться на поле.")
	}
}

func (s *Server) attackBoss(gs *GameState, attackType string, userID string) error {
	advanceBossTimers(gs)

	bossID := gs.ActiveBossID
	boss, idx, ok := currentBoss(gs, bossID)
	if !ok {
		return fmt.Errorf("сначала выбери босса")
	}
	if boss.Defeated {
		if boss.KillsToday >= 8 {
			return fmt.Errorf("дневной лимит этого босса достигнут: 8/8")
		}
		prepareBossBattle(&gs.Bosses[idx], time.Now())
		boss = &gs.Bosses[idx]
	}

	baseDamage, label, cost, ok := attackConfig(attackType)
	damage := baseDamage + attackBonusDamage(gs, attackType)
	chargeAttack := attackConsumesChargeWithoutCooldown(attackType)
	if !ok {
		return fmt.Errorf("неизвестный удар")
	}
	if cost > 0 && gs.Player.Inventory[attackType] <= 0 {
		return fmt.Errorf("сначала купи эту атаку")
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
	refreshBossKillLimit(boss)
	if !chargeAttack {
		if until, ok := boss.AttackCooldowns[attackType]; ok && now.Before(until) {
			return fmt.Errorf("удар %s ещё перезаряжается", label)
		}
	}

	if boss.HP-damage <= 0 && boss.KillsToday >= 8 {
		return fmt.Errorf("дневной лимит убийств этого босса достигнут: 8/8")
	}

	actualDamage := min(damage, boss.HP)
	recordBossDamage(gs, actualDamage, now)
	recordBossBattleDamage(gs, actualDamage)
	talentDamageProgress(gs, actualDamage)
	s.recordLeaderboardDamage(context.Background(), userID, actualDamage, now)
	gs.Bosses[idx].HP = max(0, boss.HP-damage)
	if cost > 0 {
		if gs.Player.Inventory == nil {
			gs.Player.Inventory = map[string]int{}
		}
		gs.Player.Inventory[attackType] = max(0, gs.Player.Inventory[attackType]-1)
	}
	if chargeAttack {
		delete(gs.Bosses[idx].AttackCooldowns, attackType)
	} else {
		gs.Bosses[idx].AttackCooldowns[attackType] = now.Add(bossAttackCooldown)
	}
	appendLog(gs, fmt.Sprintf("Хомяк использовал %s и нанёс %d урона %s.", label, damage, boss.Name))

	if gs.Bosses[idx].HP == 0 {
		finalizeBossVictory(gs, idx, now)
	}

	if strings.TrimSpace(userID) != "" {
		s.mirrorBossDamageToFriends(context.Background(), userID, bossID, damage, now)
	}

	if gs.Bosses[idx].HP == 0 {
		return nil
	}

	counter := max(1, gs.Bosses[idx].Attack+randInt(5)-2-gs.Player.Defense/2)
	gs.Player.HP = max(0, gs.Player.HP-counter)
	appendLog(gs, fmt.Sprintf("%s отвечает и наносит %d урона.", boss.Name, counter))
	if gs.Player.HP == 0 {
		gs.Player.HP = gs.Player.MaxHP
		appendLog(gs, "Хомяк отступил и пришёл в себя.")
	}
	return nil
}

func (s *Server) mirrorBossDamageToFriends(ctx context.Context, attackerID, bossID string, damage int, now time.Time) {
	attackerID = strings.TrimSpace(attackerID)
	bossID = strings.TrimSpace(bossID)
	if attackerID == "" || bossID == "" || damage <= 0 {
		return
	}
	friendIDs, err := s.friendIDs(ctx, attackerID)
	if err != nil {
		return
	}
	for _, friendID := range friendIDs {
		friendID = strings.TrimSpace(friendID)
		if friendID == "" || friendID == attackerID {
			continue
		}
		friendState, err := s.loadState(ctx, friendID)
		if err != nil {
			continue
		}
		advanceBossTimers(&friendState)
		friendState.UpdatedAt = now
		if friendState.ActiveBossID != bossID {
			continue
		}
		friendBoss, friendIdx, ok := currentBoss(&friendState, bossID)
		if !ok || friendBoss == nil || friendBoss.Defeated {
			continue
		}
		if !friendBoss.BattleEndsAt.IsZero() && now.After(friendBoss.BattleEndsAt) {
			continue
		}
		actualDamage := min(damage, friendBoss.HP)
		if actualDamage <= 0 {
			continue
		}
		recordBossDamage(&friendState, actualDamage, now)
		recordBossBattleDamage(&friendState, actualDamage)
		talentDamageProgress(&friendState, actualDamage)
		s.recordLeaderboardDamage(ctx, friendID, actualDamage, now)
		friendState.Bosses[friendIdx].HP = max(0, friendBoss.HP-damage)
		if friendState.Bosses[friendIdx].HP == 0 {
			finalizeBossVictory(&friendState, friendIdx, now)
		}
		_ = s.saveState(ctx, friendID, friendState)
	}
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
		addCurrencyGain(gs, Seeds, seedGain)
		appendLog(gs, fmt.Sprintf("Награда за действие: +%d опыта и +%d семечек.", xpGain, seedGain))
		recalcLevel(gs)
	}
	appendLog(gs, fmt.Sprintf("%s пройден на %d/%d.", node.Name, gs.Adventure[idx].Progress, node.RequiredPasses))

	if gs.Adventure[idx].Progress >= node.RequiredPasses {
		gs.Adventure[idx].Completed = true
		appendLog(gs, fmt.Sprintf("%s полностью пройдена!", node.Name))
		if adventureFinished(gs) {
			gs.LocationPasses++
			resetAdventureLoop(gs)
			appendLog(gs, fmt.Sprintf("Локация пройдена полностью! Всего проходок локации: %d. Путь начинается заново.", gs.LocationPasses))
		} else {
			next := firstIncompleteAdventureIndex(gs)
			if next >= 0 {
				gs.ActiveAdventureID = gs.Adventure[next].ID
				appendLog(gs, fmt.Sprintf("Открыта %s.", gs.Adventure[next].Name))
			}
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

func (s *Server) buyAttack(gs *GameState, attackType string) error {
	baseDamage, label, cost, ok := attackConfig(attackType)
	damage := baseDamage + attackBonusDamage(gs, attackType)
	_ = damage
	if !ok {
		return fmt.Errorf("атака не найдена")
	}
	if cost <= 0 {
		return fmt.Errorf("эту атаку покупать не нужно")
	}
	if gs.Player.Currency[Wheat] < cost {
		return fmt.Errorf("не хватает пшеницы")
	}
	if gs.Player.Inventory == nil {
		gs.Player.Inventory = map[string]int{}
	}
	gs.Player.Currency[Wheat] -= cost
	gs.Player.Inventory[attackType] = gs.Player.Inventory[attackType] + 1
	appendLog(gs, fmt.Sprintf("Куплена атака %s за %d пшеницы.", label, cost))
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
		if value != "default" && gs.Player.Inventory[value] <= 0 {
			return fmt.Errorf("сначала выбей этот скин")
		}
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

func talentClassExists(classID string) bool {
	switch strings.TrimSpace(classID) {
	case "martial_arts", "authority", "berserk":
		return true
	default:
		return false
	}
}

func talentSkillClass(skillID string) string {
	switch strings.TrimSpace(skillID) {
	case "martial_energy", "martial_bite":
		return "martial_arts"
	case "authority_scratch", "authority_shop_income", "authority_wip_tier2":
		return "authority"
	case "authority_wheel_xp", "authority_wip_tier3":
		return "authority"
	case "berserk_poison", "berserk_lasers", "berserk_iron_claw":
		return "berserk"
	default:
		return ""
	}
}

func talentSkillWIP(skillID string) bool {
	return false
}

func talentSkillMaxRank(skillID string) int {
	switch strings.TrimSpace(skillID) {
	case "martial_energy", "martial_bite", "authority_scratch", "authority_shop_income", "authority_wheel_xp", "berserk_poison", "berserk_lasers", "berserk_iron_claw":
		return 10
	default:
		return 0
	}
}

func talentSkillPrerequisite(skillID string) (string, int) {
	switch strings.TrimSpace(skillID) {
	case "martial_bite":
		return "martial_energy", 10
	case "authority_shop_income", "authority_wip_tier2":
		return "authority_scratch", 10
	case "authority_wheel_xp", "authority_wip_tier3":
		return "authority_shop_income", 10
	case "berserk_lasers":
		return "berserk_poison", 10
	case "berserk_iron_claw":
		return "berserk_lasers", 10
	default:
		return "", 0
	}
}

func talentRank(gs *GameState, skillID string) int {
	if gs == nil || gs.Player.Talents == nil {
		return 0
	}
	return max(0, gs.Player.Talents[skillID])
}

func normalizeTalentState(gs *GameState) {
	if gs == nil {
		return
	}
	if gs.Player.Talents == nil {
		gs.Player.Talents = map[string]int{}
	}
	if value, ok := gs.Player.Talents["martial_scratch"]; ok {
		if _, exists := gs.Player.Talents["martial_bite"]; !exists {
			gs.Player.Talents["martial_bite"] = value
		}
		delete(gs.Player.Talents, "martial_scratch")
	}
	if value, ok := gs.Player.Talents["authority_wip_tier2"]; ok {
		if _, exists := gs.Player.Talents["authority_shop_income"]; !exists {
			gs.Player.Talents["authority_shop_income"] = value
		}
		delete(gs.Player.Talents, "authority_wip_tier2")
	}
	if value, ok := gs.Player.Talents["authority_wip_tier3"]; ok {
		if _, exists := gs.Player.Talents["authority_wheel_xp"]; !exists {
			gs.Player.Talents["authority_wheel_xp"] = value
		}
		delete(gs.Player.Talents, "authority_wip_tier3")
	}
	for key, rank := range gs.Player.Talents {
		if talentSkillClass(key) == "" {
			delete(gs.Player.Talents, key)
			continue
		}
		if rank < 0 {
			gs.Player.Talents[key] = 0
		}
		if rank > 10 {
			gs.Player.Talents[key] = 10
		}
	}
	if gs.Player.TalentClass != "" && !talentClassExists(gs.Player.TalentClass) {
		gs.Player.TalentClass = ""
	}
	if gs.Player.TalentPoints < 0 {
		gs.Player.TalentPoints = 0
	}
	if gs.Player.TalentDamageProgress < 0 {
		gs.Player.TalentDamageProgress = 0
	}
	if gs.Player.TalentNextThreshold < 70 {
		gs.Player.TalentNextThreshold = 70
	}
}

func selectTalentClass(gs *GameState, classID string) error {
	classID = strings.TrimSpace(classID)
	if !talentClassExists(classID) {
		return fmt.Errorf("неизвестный класс")
	}
	if gs.Player.TalentClass != "" && gs.Player.TalentClass != classID {
		return fmt.Errorf("класс уже выбран")
	}
	gs.Player.TalentClass = classID
	appendLog(gs, fmt.Sprintf("Выбран класс талантов: %s.", classID))
	return nil
}

func buyTalentRank(gs *GameState, skillID string) error {
	skillID = strings.TrimSpace(skillID)
	classID := talentSkillClass(skillID)
	if classID == "" {
		return fmt.Errorf("талант не найден")
	}
	if gs.Player.TalentClass == "" {
		return fmt.Errorf("сначала выбери класс")
	}
	if gs.Player.TalentClass != classID {
		return fmt.Errorf("этот талант относится к другому классу")
	}
	if talentSkillWIP(skillID) {
		return fmt.Errorf("талант пока в разработке")
	}
	maxRank := talentSkillMaxRank(skillID)
	if maxRank <= 0 {
		return fmt.Errorf("талант не найден")
	}
	if prereqSkill, prereqRank := talentSkillPrerequisite(skillID); prereqSkill != "" {
		if talentRank(gs, prereqSkill) < prereqRank {
			return fmt.Errorf("сначала прокачай предыдущий талант до %d/%d", prereqRank, prereqRank)
		}
	}
	if talentRank(gs, skillID) >= maxRank {
		return fmt.Errorf("талант уже прокачан полностью")
	}
	if gs.Player.TalentPoints <= 0 {
		return fmt.Errorf("не хватает очков талантов")
	}
	if gs.Player.Talents == nil {
		gs.Player.Talents = map[string]int{}
	}
	gs.Player.Talents[skillID] = talentRank(gs, skillID) + 1
	gs.Player.TalentPoints--
	gs.Player.TalentPointsSpent++
	switch skillID {
	case "martial_energy":
		gs.Player.MaxEnergy++
		if gs.Player.Energy < gs.Player.MaxEnergy {
			gs.Player.Energy++
		}
	}
	appendLog(gs, fmt.Sprintf("Прокачан талант %s до %d/%d.", skillID, gs.Player.Talents[skillID], maxRank))
	return nil
}

func talentAttackBonusDamage(gs *GameState, attackType string) int {
	if gs == nil {
		return 0
	}
	if gs.Player.TalentClass == "martial_arts" && attackType == "bite" {
		return 5 * talentRank(gs, "martial_bite")
	}
	if gs.Player.TalentClass == "authority" && attackType == "scratch" {
		return 2 * talentRank(gs, "authority_scratch")
	}
	if gs.Player.TalentClass == "berserk" {
		switch attackType {
		case "poison_bite":
			return 15 * talentRank(gs, "berserk_poison")
		case "eye_lasers":
			return 30 * talentRank(gs, "berserk_lasers")
		case "iron_claw":
			return 12 * talentRank(gs, "berserk_iron_claw")
		}
	}
	return 0
}

func talentDamageProgress(gs *GameState, amount int) {
	if gs == nil || amount <= 0 {
		return
	}
	if gs.Player.TalentNextThreshold < 70 {
		gs.Player.TalentNextThreshold = 70
	}
	gs.Player.TalentDamageProgress += amount
	if gs.Player.TalentDamageProgress >= gs.Player.TalentNextThreshold {
		gs.Player.TalentPoints++
		gs.Player.TalentDamageProgress = 0
		gs.Player.TalentNextThreshold += 50
		appendLog(gs, fmt.Sprintf("Получено 1 очко талантов. Теперь доступно %d.", gs.Player.TalentPoints))
	}
}

func (s *Server) selectTalentClass(gs *GameState, classID string) error {
	if gs == nil {
		return fmt.Errorf("игровое состояние недоступно")
	}
	classID = strings.TrimSpace(classID)
	if classID == "" {
		return fmt.Errorf("выбери класс талантов")
	}
	if !talentClassExists(classID) {
		return fmt.Errorf("неизвестный класс талантов")
	}
	if gs.Player.TalentClass != "" && gs.Player.TalentClass != classID {
		return fmt.Errorf("класс уже выбран")
	}
	gs.Player.TalentClass = classID
	if gs.Player.Talents == nil {
		gs.Player.Talents = map[string]int{}
	}
	appendLog(gs, fmt.Sprintf("Выбран класс талантов: %s.", classID))
	return nil
}

func (s *Server) buyTalentRank(gs *GameState, skillID string) error {
	if gs == nil {
		return fmt.Errorf("игровое состояние недоступно")
	}
	skillID = strings.TrimSpace(skillID)
	if skillID == "" {
		return fmt.Errorf("талант не найден")
	}
	classID := talentSkillClass(skillID)
	if classID == "" {
		return fmt.Errorf("талант не найден")
	}
	skillClassSelected := gs.Player.TalentClass != "" && gs.Player.TalentClass != classID
	if skillClassSelected {
		return fmt.Errorf("этот талант не подходит текущему классу")
	}
	if talentSkillWIP(skillID) {
		return fmt.Errorf("этот талант ещё в разработке")
	}
	maxRank := talentSkillMaxRank(skillID)
	if prereqSkill, prereqRank := talentSkillPrerequisite(skillID); prereqSkill != "" {
		if talentRank(gs, prereqSkill) < prereqRank {
			return fmt.Errorf("сначала прокачай предыдущий талант до %d/%d", prereqRank, prereqRank)
		}
	}
	if talentRank(gs, skillID) >= maxRank {
		return fmt.Errorf("талант уже прокачан до максимума")
	}
	if gs.Player.TalentPoints <= 0 {
		return fmt.Errorf("не хватает очков талантов")
	}
	if gs.Player.Talents == nil {
		gs.Player.Talents = map[string]int{}
	}
	gs.Player.Talents[skillID] = talentRank(gs, skillID) + 1
	gs.Player.TalentPoints--
	gs.Player.TalentPointsSpent++
	switch skillID {
	case "martial_energy":
		if gs.Player.MaxEnergy <= 0 {
			gs.Player.MaxEnergy = 40
		}
		gs.Player.MaxEnergy++
		if gs.Player.Energy < gs.Player.MaxEnergy {
			gs.Player.Energy++
		}
	}
	appendLog(gs, fmt.Sprintf("Талант %s улучшен до %d/%d.", skillID, gs.Player.Talents[skillID], maxRank))
	return nil
}

func attackConfig(attackType string) (int, string, int, bool) {
	switch attackType {
	case "belly_punch":
		return 5, "удар пузиком", 0, true
	case "scratch":
		return 20, "царапанье", 0, true
	case "rush":
		return 15, "удар с разбега", 0, true
	case "bite":
		return 30, "укус", 0, true
	case "iron_claw":
		return 100, "удар железным когтем", 2, true
	case "poison_bite":
		return 300, "ядовитый укус", 6, true
	case "eye_lasers":
		return 700, "лазеры из глаз", 13, true
	default:
		return 0, "", 0, false
	}
}

func attackConsumesChargeWithoutCooldown(attackType string) bool {
	switch attackType {
	case "iron_claw", "poison_bite", "eye_lasers":
		return true
	default:
		return false
	}
}

type bossCosmeticDrop struct {
	ItemID string
	Label  string
	Chance int
}

func bossCosmeticDropFor(bossID string) (bossCosmeticDrop, bool) {
	switch bossID {
	case "rat":
		return bossCosmeticDrop{ItemID: "color2", Label: "серый скин хомяка", Chance: 25}, true
	case "lizard":
		return bossCosmeticDrop{ItemID: "color1", Label: "зеленый скин хомяка", Chance: 25}, true
	default:
		return bossCosmeticDrop{}, false
	}
}

func cosmeticDropBonusText(bossID string) string {
	switch bossID {
	case "rat":
		return "Бонус за скин: +5 к удару пузиком и +5 к удару железным когтем."
	case "lizard":
		return "Бонус за скин: +20 к урону ядовитого укуса."
	default:
		return ""
	}
}

func attackBonusDamage(gs *GameState, attackType string) int {
	if gs == nil {
		return 0
	}
	bonus := 0
	switch attackType {
	case "belly_punch", "iron_claw":
		if gs.Player.Inventory["color2"] > 0 {
			bonus += 5
		}
	case "poison_bite":
		if gs.Player.Inventory["color1"] > 0 {
			bonus += 20
		}
	}
	bonus += talentAttackBonusDamage(gs, attackType)
	return bonus
}

func maybeGrantBossCosmeticDrop(gs *GameState, boss *Boss) string {
	drop, ok := bossCosmeticDropFor(boss.ID)
	if !ok || gs == nil {
		return ""
	}
	n, err := rand.Int(rand.Reader, big.NewInt(100))
	if err != nil || n.Int64() >= int64(drop.Chance) {
		return ""
	}
	if gs.Player.Inventory == nil {
		gs.Player.Inventory = map[string]int{}
	}
	gs.Player.Inventory[drop.ItemID] = gs.Player.Inventory[drop.ItemID] + 1
	return drop.Label
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
			TalentClass:          "",
			TalentPoints:         0,
			TalentPointsSpent:    0,
			TalentDamageProgress: 0,
			TalentNextThreshold:  70,
			Talents:              map[string]int{},
		},
		Location: "Поле",
		Bosses: []Boss{
			{
				ID:               "rat",
				Name:             "Крыса",
				HP:               70,
				MaxHP:            70,
				Attack:           4,
				Reward:           map[Currency]int{Seeds: 20, Wheat: 2, Carrot: 1, Cucumber: 0},
				XP:               10,
				Defeated:         false,
				AttackCooldowns:  map[string]time.Time{},
				KillsToday:       0,
				KillsDay:         bossKillDayKey(),
				KillsTotal:       0,
				BestClearSeconds: 0,
			},
			{
				ID:               "lizard",
				Name:             "Ящерица",
				HP:               150,
				MaxHP:            150,
				Attack:           8,
				Reward:           map[Currency]int{Seeds: 50, Wheat: 3, Carrot: 0, Cucumber: 1},
				XP:               20,
				Defeated:         false,
				AttackCooldowns:  map[string]time.Time{},
				KillsToday:       0,
				KillsDay:         bossKillDayKey(),
				KillsTotal:       0,
				BestClearSeconds: 0,
			},
			{
				ID:               "swagusinitsa",
				Name:             "Свагусиница",
				HP:               600,
				MaxHP:            600,
				Attack:           12,
				Reward:           map[Currency]int{Seeds: 200, Wheat: 0, Carrot: 2, Cucumber: 1},
				XP:               50,
				Defeated:         false,
				AttackCooldowns:  map[string]time.Time{},
				KillsToday:       0,
				KillsDay:         bossKillDayKey(),
				KillsTotal:       0,
				BestClearSeconds: 0,
			},
			{
				ID:               "sand_lizard",
				Name:             "Песчаная ящерица",
				HP:               7000,
				MaxHP:            7000,
				Attack:           16,
				Reward:           map[Currency]int{Seeds: 1000, Wheat: 0, Carrot: 5, Cucumber: 2},
				XP:               300,
				Defeated:         false,
				AttackCooldowns:  map[string]time.Time{},
				KillsToday:       0,
				KillsDay:         bossKillDayKey(),
				KillsTotal:       0,
				BestClearSeconds: 0,
			},
			{
				ID:               "sand_snake",
				Name:             "Песчаная змея",
				HP:               15000,
				MaxHP:            15000,
				Attack:           24,
				Reward:           map[Currency]int{Seeds: 2000, Wheat: 10, Carrot: 10, Cucumber: 4},
				XP:               500,
				Defeated:         false,
				AttackCooldowns:  map[string]time.Time{},
				KillsToday:       0,
				KillsDay:         bossKillDayKey(),
				KillsTotal:       0,
				BestClearSeconds: 0,
			},
			{
				ID:               "cave_centipede",
				Name:             "Пещерная многоножка",
				HP:               1200,
				MaxHP:            1200,
				Attack:           14,
				Reward:           map[Currency]int{Seeds: 400, Wheat: 0, Carrot: 2, Cucumber: 1},
				XP:               100,
				Defeated:         false,
				AttackCooldowns:  map[string]time.Time{},
				KillsToday:       0,
				KillsDay:         bossKillDayKey(),
				KillsTotal:       0,
				BestClearSeconds: 0,
			},
			{
				ID:               "cave_bird",
				Name:             "Пещерная птица",
				HP:               3400,
				MaxHP:            3400,
				Attack:           18,
				Reward:           map[Currency]int{Seeds: 500, Wheat: 0, Carrot: 3, Cucumber: 2},
				XP:               200,
				Defeated:         false,
				AttackCooldowns:  map[string]time.Time{},
				KillsToday:       0,
				KillsDay:         bossKillDayKey(),
				KillsTotal:       0,
				BestClearSeconds: 0,
			},
			{
				ID:               "cave_spider",
				Name:             "Пещерный паук",
				HP:               24000,
				MaxHP:            24000,
				Attack:           32,
				Reward:           map[Currency]int{Seeds: 2000, Wheat: 0, Carrot: 8, Cucumber: 2, Apple: 1},
				XP:               800,
				Defeated:         false,
				AttackCooldowns:  map[string]time.Time{},
				KillsToday:       0,
				KillsDay:         bossKillDayKey(),
				KillsTotal:       0,
				BestClearSeconds: 0,
			},
			{
				ID:               "honey_badger",
				Name:             "Медоед",
				HP:               1000000,
				MaxHP:            1000000,
				Attack:           40,
				Reward:           map[Currency]int{Seeds: 25000, Wheat: 25, Carrot: 30, Cucumber: 10, Apple: 2},
				XP:               15000,
				Defeated:         false,
				AttackCooldowns:  map[string]time.Time{},
				KillsToday:       0,
				KillsDay:         bossKillDayKey(),
				KillsTotal:       0,
				BestClearSeconds: 0,
			},
		},
		Adventure:               defaultAdventureNodes(),
		ActiveAdventureID:       adventureBlueprints[0].ID,
		ActiveBossID:            "",
		Business:                Business{},
		BossKillsToday:          0,
		BossKillsDay:            bossKillDayKey(),
		LocationPasses:          0,
		BossDamageDay:           0,
		BossDamageDayKey:        damageDayKey(time.Now()),
		BossDamageWeek:          0,
		BossDamageWeekKey:       damageWeekKey(time.Now()),
		BossDamageMonth:         0,
		BossDamageMonthKey:      damageMonthKey(time.Now()),
		BossDamageAllTime:       0,
		BossBattleDamageCurrent: 0,
		BossBattleDamageBest:    0,
		Log:                     []string{"Добро пожаловать в поле хомяков."},
		UpdatedAt:               time.Now(),
		LastEnergyRegenAt:       time.Now(),
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
		return 2, 3
	case 2:
		return 3, 5
	case 3:
		return 3, 6
	case 4:
		return 3, 10
	default:
		return 0, 0
	}
}

func currentLeaderboardPeriodKey(period string, now time.Time) string {
	local := now.In(gameLocation())
	switch period {
	case "day":
		return local.Format("2006-01-02")
	case "week":
		year, week := local.ISOWeek()
		return fmt.Sprintf("%04d-W%02d", year, week)
	case "month":
		return local.Format("2006-01")
	default:
		return ""
	}
}

func previousLeaderboardPeriodKey(period string, now time.Time) string {
	local := now.In(gameLocation())
	switch period {
	case "day":
		return local.AddDate(0, 0, -1).Format("2006-01-02")
	case "week":
		prev := local.AddDate(0, 0, -7)
		year, week := prev.ISOWeek()
		return fmt.Sprintf("%04d-W%02d", year, week)
	case "month":
		return local.AddDate(0, -1, 0).Format("2006-01")
	default:
		return ""
	}
}

func damageDayKey(now time.Time) string {
	return now.In(gameLocation()).Format("2006-01-02")
}

func damageWeekKey(now time.Time) string {
	local := now.In(gameLocation())
	year, week := local.ISOWeek()
	return fmt.Sprintf("%04d-W%02d", year, week)
}

func damageMonthKey(now time.Time) string {
	return now.In(gameLocation()).Format("2006-01")
}

func normalizeBossDamageStats(gs *GameState) {
	if gs == nil {
		return
	}
	now := time.Now()
	dayKey := damageDayKey(now)
	weekKey := damageWeekKey(now)
	monthKey := damageMonthKey(now)

	if gs.BossDamageDayKey != dayKey {
		gs.BossDamageDay = 0
		gs.BossDamageDayKey = dayKey
	}
	if gs.BossDamageWeekKey != weekKey {
		gs.BossDamageWeek = 0
		gs.BossDamageWeekKey = weekKey
	}
	if gs.BossDamageMonthKey != monthKey {
		gs.BossDamageMonth = 0
		gs.BossDamageMonthKey = monthKey
	}
	if gs.BossDamageDay < 0 {
		gs.BossDamageDay = 0
	}
	if gs.BossDamageWeek < 0 {
		gs.BossDamageWeek = 0
	}
	if gs.BossDamageMonth < 0 {
		gs.BossDamageMonth = 0
	}
	if gs.BossDamageAllTime < 0 {
		gs.BossDamageAllTime = 0
	}
	if gs.BossBattleDamageCurrent < 0 {
		gs.BossBattleDamageCurrent = 0
	}
	if gs.BossBattleDamageBest < 0 {
		gs.BossBattleDamageBest = 0
	}
	if gs.BossBattleDamageBest < gs.BossBattleDamageCurrent {
		gs.BossBattleDamageBest = gs.BossBattleDamageCurrent
	}
}

func recordBossDamage(gs *GameState, amount int, now time.Time) {
	if gs == nil || amount <= 0 {
		return
	}
	normalizeBossDamageStats(gs)
	gs.BossDamageDay += amount
	gs.BossDamageWeek += amount
	gs.BossDamageMonth += amount
	gs.BossDamageAllTime += amount
	gs.BossDamageDayKey = damageDayKey(now)
	gs.BossDamageWeekKey = damageWeekKey(now)
	gs.BossDamageMonthKey = damageMonthKey(now)
}

func recordBossBattleDamage(gs *GameState, amount int) {
	if gs == nil || amount <= 0 {
		return
	}
	if gs.BossBattleDamageCurrent < 0 {
		gs.BossBattleDamageCurrent = 0
	}
	if gs.BossBattleDamageBest < 0 {
		gs.BossBattleDamageBest = 0
	}
	gs.BossBattleDamageCurrent += amount
	if gs.BossBattleDamageCurrent > gs.BossBattleDamageBest {
		gs.BossBattleDamageBest = gs.BossBattleDamageCurrent
	}
}

func resetAdventureLoop(gs *GameState) {
	if gs == nil {
		return
	}
	for i := range gs.Adventure {
		gs.Adventure[i].Progress = 0
		gs.Adventure[i].Completed = false
	}
	if len(gs.Adventure) > 0 {
		gs.ActiveAdventureID = gs.Adventure[0].ID
	}
}

func adventureFinished(gs *GameState) bool {
	if gs == nil || len(gs.Adventure) == 0 {
		return false
	}
	for i := range gs.Adventure {
		if !gs.Adventure[i].Completed {
			return false
		}
	}
	return true
}

func refreshBossKillLimit(boss *Boss) {
	if boss == nil {
		return
	}
	day := bossKillDayKey()
	dayChanged := boss.KillsDay != day
	if dayChanged {
		boss.KillsDay = day
		boss.KillsToday = 0
		boss.Defeated = false
		boss.HP = boss.MaxHP
		boss.BattleStartedAt = time.Time{}
		boss.BattleEndsAt = time.Time{}
		boss.AttackCooldowns = map[string]time.Time{}
	}
	if boss.KillsToday < 0 {
		boss.KillsToday = 0
	}
	if boss.KillsToday > 8 {
		boss.KillsToday = 8
	}
}

func normalizeBosses(gs *GameState) {
	type bossTemplate struct {
		id     string
		name   string
		hp     int
		attack int
		xp     int
		reward map[Currency]int
	}
	templates := []bossTemplate{
		{id: "rat", name: "Крыса", hp: 70, attack: 4, xp: 10, reward: map[Currency]int{Seeds: 20, Wheat: 2, Carrot: 1, Cucumber: 0}},
		{id: "lizard", name: "Ящерица", hp: 150, attack: 8, xp: 20, reward: map[Currency]int{Seeds: 50, Wheat: 3, Carrot: 0, Cucumber: 1}},
		{id: "swagusinitsa", name: "Свагусиница", hp: 600, attack: 12, xp: 50, reward: map[Currency]int{Seeds: 200, Wheat: 0, Carrot: 2, Cucumber: 1}},
		{id: "sand_lizard", name: "Песчаная ящерица", hp: 7000, attack: 16, xp: 300, reward: map[Currency]int{Seeds: 1000, Wheat: 0, Carrot: 5, Cucumber: 2}},
		{id: "sand_snake", name: "Песчаная змея", hp: 15000, attack: 24, xp: 500, reward: map[Currency]int{Seeds: 2000, Wheat: 10, Carrot: 10, Cucumber: 4}},
		{id: "cave_centipede", name: "Пещерная многоножка", hp: 1200, attack: 14, xp: 100, reward: map[Currency]int{Seeds: 400, Wheat: 0, Carrot: 2, Cucumber: 1}},
		{id: "cave_bird", name: "Пещерная птица", hp: 3400, attack: 18, xp: 200, reward: map[Currency]int{Seeds: 500, Wheat: 0, Carrot: 3, Cucumber: 2}},
		{id: "cave_spider", name: "Пещерный паук", hp: 24000, attack: 32, xp: 800, reward: map[Currency]int{Seeds: 2000, Wheat: 0, Carrot: 8, Cucumber: 2, Apple: 1}},
		{id: "honey_badger", name: "Медоед", hp: 1000000, attack: 40, xp: 15000, reward: map[Currency]int{Seeds: 25000, Wheat: 25, Carrot: 30, Cucumber: 10, Apple: 2}},
	}
	byID := map[string]Boss{}
	for i := range gs.Bosses {
		boss := gs.Bosses[i]
		if strings.TrimSpace(boss.ID) == "" {
			continue
		}
		byID[boss.ID] = boss
	}
	normalized := make([]Boss, 0, len(templates))
	for _, tpl := range templates {
		boss := byID[tpl.id]
		boss.ID = tpl.id
		boss.Name = tpl.name
		boss.MaxHP = tpl.hp
		boss.Attack = tpl.attack
		boss.XP = tpl.xp
		if boss.Reward == nil {
			boss.Reward = map[Currency]int{}
		}
		boss.Reward[Seeds] = tpl.reward[Seeds]
		boss.Reward[Wheat] = tpl.reward[Wheat]
		boss.Reward[Carrot] = tpl.reward[Carrot]
		boss.Reward[Cucumber] = tpl.reward[Cucumber]
		if boss.AttackCooldowns == nil {
			boss.AttackCooldowns = map[string]time.Time{}
		}
		if boss.KillsToday < 0 {
			boss.KillsToday = 0
		}
		if boss.KillsTotal < 0 {
			boss.KillsTotal = 0
		}
		refreshBossKillLimit(&boss)
		if boss.HP < 0 {
			boss.HP = 0
		}
		if boss.HP > boss.MaxHP {
			boss.HP = boss.MaxHP
		}
		if boss.Defeated || boss.HP == 0 {
			boss.Defeated = true
			boss.HP = 0
			boss.BattleStartedAt = time.Time{}
			boss.BattleEndsAt = time.Time{}
			boss.AttackCooldowns = map[string]time.Time{}
		}
		normalized = append(normalized, boss)
	}
	gs.Bosses = normalized
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

func resetTalentBattleProgress(gs *GameState) {
	if gs == nil {
		return
	}
	gs.Player.TalentDamageProgress = 0
}

func resetBossBattleDamage(gs *GameState) {
	if gs == nil {
		return
	}
	gs.BossBattleDamageCurrent = 0
	resetTalentBattleProgress(gs)
}

func resetBossBattle(boss *Boss) {
	if boss == nil {
		return
	}
	boss.BattleStartedAt = time.Time{}
	boss.BattleEndsAt = time.Time{}
	boss.AttackCooldowns = map[string]time.Time{}
}

func prepareBossBattle(boss *Boss, now time.Time) {
	if boss == nil || boss.KillsToday >= 8 {
		return
	}
	boss.Defeated = false
	boss.HP = boss.MaxHP
	boss.BattleStartedAt = now
	boss.BattleEndsAt = now.Add(bossBattleDuration)
	boss.AttackCooldowns = map[string]time.Time{}
}

func advanceBossTimers(gs *GameState) {
	now := time.Now()
	for i := range gs.Bosses {
		boss := &gs.Bosses[i]
		if boss.AttackCooldowns == nil {
			boss.AttackCooldowns = map[string]time.Time{}
		}
		refreshBossKillLimit(boss)
		if boss.Defeated {
			resetBossBattle(boss)
			if gs.ActiveBossID == boss.ID {
				resetBossBattleDamage(gs)
				gs.ActiveBossID = ""
			}
			continue
		}
		if !boss.BattleEndsAt.IsZero() && now.After(boss.BattleEndsAt) {
			appendLog(gs, fmt.Sprintf("Битва с %s завершилась поражением по таймеру.", boss.Name))
			boss.HP = boss.MaxHP
			resetBossBattle(boss)
			if gs.ActiveBossID == boss.ID {
				resetBossBattleDamage(gs)
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

func bossUnlockPasses(bossID string) int {
	switch strings.TrimSpace(bossID) {
	case "sand_lizard", "sand_snake", "cave_centipede", "cave_bird", "cave_spider", "honey_badger":
		return 1
	default:
		return 0
	}
}

func bossLockedByProgress(gs *GameState, bossID string) bool {
	if gs == nil {
		return false
	}
	return gs.LocationPasses < bossUnlockPasses(bossID)
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

func businessNextCost(level, base, step int) int {
	if level <= 0 {
		return 0
	}
	if level >= 100 {
		return 0
	}
	return base + step*(level-1)
}

func advanceBusiness(gs *GameState) {
	if gs == nil {
		return
	}
	now := time.Now()
	authorityShopBonus := 0
	authorityWheelBonus := 0
	if gs.Player.TalentClass == "authority" {
		authorityShopBonus = 5 * talentRank(gs, "authority_shop_income")
		authorityWheelBonus = talentRank(gs, "authority_wheel_xp")
	}
	if gs.Business.ShopLevel > 0 {
		if gs.Business.ShopLastClaimAt.IsZero() {
			gs.Business.ShopLastClaimAt = now
		}
		elapsed := now.Sub(gs.Business.ShopLastClaimAt)
		if elapsed >= businessCycle {
			cycles := int(elapsed / businessCycle)
			payout := cycles * gs.Business.ShopLevel * 10
			payout += cycles * authorityShopBonus
			if payout > 0 {
				addCurrencyGain(gs, Seeds, payout)
			}
			gs.Business.ShopLastClaimAt = gs.Business.ShopLastClaimAt.Add(time.Duration(cycles) * businessCycle)
		}
	}
	if gs.Business.WheelLevel > 0 {
		if gs.Business.WheelLastClaimAt.IsZero() {
			gs.Business.WheelLastClaimAt = now
		}
		elapsed := now.Sub(gs.Business.WheelLastClaimAt)
		if elapsed >= businessCycle {
			cycles := int(elapsed / businessCycle)
			payout := cycles * gs.Business.WheelLevel
			payout += cycles * authorityWheelBonus
			if payout > 0 {
				gs.Player.XP += payout
				recalcLevel(gs)
			}
			gs.Business.WheelLastClaimAt = gs.Business.WheelLastClaimAt.Add(time.Duration(cycles) * businessCycle)
		}
	}
}

func (s *Server) buyBusiness(gs *GameState, item string) error {
	if gs == nil {
		return fmt.Errorf("игровое состояние недоступно")
	}
	if gs.Player.Level < businessUnlockLevel {
		return fmt.Errorf("бизнес откроется с %d уровня", businessUnlockLevel)
	}
	advanceBusiness(gs)
	now := time.Now()

	switch item {
	case "shop":
		if gs.Business.ShopLevel <= 0 {
			if gs.Player.Currency[Seeds] < 1000 {
				return fmt.Errorf("для покупки магазина нужно 1000 семечек")
			}
			gs.Player.Currency[Seeds] -= 1000
			gs.Business.ShopLevel = 1
			gs.Business.ShopLastClaimAt = now
			appendLog(gs, "Магазин куплен.")
			return nil
		}
		if gs.Business.ShopLevel >= 100 {
			return fmt.Errorf("магазин уже достиг максимального уровня")
		}
		cost := businessNextCost(gs.Business.ShopLevel, 500, 50)
		if cost <= 0 {
			return fmt.Errorf("магазин уже достиг максимального уровня")
		}
		if gs.Player.Currency[Seeds] < cost {
			return fmt.Errorf("для улучшения магазина нужно %d семечек", cost)
		}
		gs.Player.Currency[Seeds] -= cost
		gs.Business.ShopLevel++
		appendLog(gs, fmt.Sprintf("Магазин улучшен до уровня %d.", gs.Business.ShopLevel))
		return nil
	case "wheel":
		if gs.Business.WheelLevel <= 0 {
			if gs.Player.Currency[Seeds] < 500 {
				return fmt.Errorf("для покупки колёсика нужно 500 семечек")
			}
			gs.Player.Currency[Seeds] -= 500
			gs.Business.WheelLevel = 1
			gs.Business.WheelLastClaimAt = now
			appendLog(gs, "Колёсико куплено.")
			return nil
		}
		if gs.Business.WheelLevel >= 100 {
			return fmt.Errorf("колёсико уже достигло максимального уровня")
		}
		cost := businessNextCost(gs.Business.WheelLevel, 300, 40)
		if cost <= 0 {
			return fmt.Errorf("колёсико уже достигло максимального уровня")
		}
		if gs.Player.Currency[Seeds] < cost {
			return fmt.Errorf("для улучшения колёсика нужно %d семечек", cost)
		}
		gs.Player.Currency[Seeds] -= cost
		gs.Business.WheelLevel++
		appendLog(gs, fmt.Sprintf("Колёсико улучшено до уровня %d.", gs.Business.WheelLevel))
		return nil
	default:
		return fmt.Errorf("неизвестный объект бизнеса")
	}
}

func (s *Server) exchangeCurrency(gs *GameState, from, to string) error {
	if gs == nil {
		return fmt.Errorf("игровое состояние недоступно")
	}
	type exchangeDef struct {
		from string
		to   string
		rate int
	}
	exchanges := map[string]exchangeDef{
		"wheat|seeds":     {from: "wheat", to: "seeds", rate: 100},
		"carrot|wheat":    {from: "carrot", to: "wheat", rate: 2},
		"cucumber|carrot": {from: "cucumber", to: "carrot", rate: 2},
		"apple|cucumber":  {from: "apple", to: "cucumber", rate: 2},
		"kormik|apple":    {from: "kormik", to: "apple", rate: 12},
	}
	key := strings.TrimSpace(from) + "|" + strings.TrimSpace(to)
	def, ok := exchanges[key]
	if !ok {
		return fmt.Errorf("неизвестный обмен")
	}
	if gs.Player.Currency == nil {
		gs.Player.Currency = map[Currency]int{}
	}
	if gs.Player.Currency[Currency(def.from)] < 1 {
		return fmt.Errorf("недостаточно ресурса для обмена")
	}
	gs.Player.Currency[Currency(def.from)]--
	gs.Player.Currency[Currency(def.to)] += def.rate
	appendLog(gs, fmt.Sprintf("Обмен: 1 %s на %d %s.", def.from, def.rate, def.to))
	return nil
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
	advanceBusiness(&s.state)
	advanceBossTimers(&s.state)
	return copyState(s.state)
}

func copyState(gs GameState) GameState {
	cp := gs
	cp.Player.Currency = copyCurrency(gs.Player.Currency)
	cp.EconomyTotals = copyCurrency(gs.EconomyTotals)
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

type leaderboardRewardSpec struct {
	period string
	reward map[Currency]int
}

var leaderboardRewardSpecs = []leaderboardRewardSpec{
	{period: "day", reward: map[Currency]int{Seeds: 50, Wheat: 5, Carrot: 1}},
	{period: "week", reward: map[Currency]int{Seeds: 200, Wheat: 15, Carrot: 6, Cucumber: 2}},
	{period: "month", reward: map[Currency]int{Seeds: 2000, Wheat: 50, Carrot: 20, Cucumber: 10, Apple: 2, Kormik: 1}},
}

func leaderboardRewardKey(period, periodKey string) string {
	return period + ":" + periodKey
}

func (s *Server) recordLeaderboardDamage(ctx context.Context, userID string, amount int, now time.Time) {
	userID = strings.TrimSpace(userID)
	if userID == "" || amount <= 0 {
		return
	}
	periods := []string{"day", "week", "month"}
	if strings.TrimSpace(s.dbURL) == "" {
		_ = s.withLocalStore(func(store *localStore) error {
			store.ensure()
			if store.LeaderboardDamage == nil {
				store.LeaderboardDamage = map[string]map[string]map[string]int{}
			}
			for _, period := range periods {
				key := currentLeaderboardPeriodKey(period, now)
				if key == "" {
					continue
				}
				if store.LeaderboardDamage[period] == nil {
					store.LeaderboardDamage[period] = map[string]map[string]int{}
				}
				if store.LeaderboardDamage[period][key] == nil {
					store.LeaderboardDamage[period][key] = map[string]int{}
				}
				store.LeaderboardDamage[period][key][userID] += amount
			}
			return nil
		})
		return
	}
	for _, period := range periods {
		key := currentLeaderboardPeriodKey(period, now)
		if key == "" {
			continue
		}
		_ = s.execPSQL(ctx, `
			INSERT INTO leaderboard_damage_stats (period_type, period_key, user_id, damage_total, updated_at)
			VALUES (:'period_type', :'period_key', :'user_id', :amount::bigint, NOW())
			ON CONFLICT (period_type, period_key, user_id)
			DO UPDATE SET damage_total = leaderboard_damage_stats.damage_total + EXCLUDED.damage_total, updated_at = NOW()
		`, map[string]string{
			"period_type": period,
			"period_key":  key,
			"user_id":     userID,
			"amount":      fmt.Sprintf("%d", amount),
		})
	}
}

func (s *Server) leaderboardEntries(ctx context.Context, period, periodKey string, limit int) ([]leaderboardEntry, error) {
	period = strings.TrimSpace(period)
	periodKey = strings.TrimSpace(periodKey)
	if period == "" || periodKey == "" {
		return []leaderboardEntry{}, nil
	}
	if limit <= 0 {
		limit = 10
	}
	if strings.TrimSpace(s.dbURL) == "" {
		var entries []leaderboardEntry
		if err := s.withLocalStore(func(store *localStore) error {
			store.ensure()
			periodMap := store.LeaderboardDamage[period]
			if periodMap == nil {
				return nil
			}
			raw := periodMap[periodKey]
			if raw == nil {
				return nil
			}
			entries = make([]leaderboardEntry, 0, len(raw))
			for userID, damage := range raw {
				login := ""
				for _, u := range store.Users {
					if u.ID == userID {
						login = u.Login
						break
					}
				}
				if strings.TrimSpace(login) == "" {
					continue
				}
				entries = append(entries, leaderboardEntry{UserID: userID, Login: login, Damage: damage})
			}
			return nil
		}); err != nil {
			return nil, err
		}
		sort.Slice(entries, func(i, j int) bool {
			if entries[i].Damage == entries[j].Damage {
				return strings.ToLower(entries[i].Login) < strings.ToLower(entries[j].Login)
			}
			return entries[i].Damage > entries[j].Damage
		})
		if len(entries) > limit {
			entries = entries[:limit]
		}
		for i := range entries {
			entries[i].Place = i + 1
		}
		return entries, nil
	}
	out, err := s.queryPSQL(ctx, `
		SELECT u.id, u.login, s.damage_total
		FROM leaderboard_damage_stats s
		JOIN users u ON u.id = s.user_id
		WHERE s.period_type = :'period_type' AND s.period_key = :'period_key'
		ORDER BY s.damage_total DESC, lower(u.login) ASC
		LIMIT (:'limit')::int
	`, map[string]string{
		"period_type": period,
		"period_key":  periodKey,
		"limit":       fmt.Sprintf("%d", limit),
	})
	if err != nil {
		return nil, err
	}
	out = strings.TrimSpace(out)
	if out == "" {
		out, err = s.queryPSQL(ctx, `
			SELECT u.id, u.login,
				CASE :'period_type'
					WHEN 'day' THEN COALESCE((gs.state_json->>'bossDamageDay')::bigint, 0)
					WHEN 'week' THEN COALESCE((gs.state_json->>'bossDamageWeek')::bigint, 0)
					WHEN 'month' THEN COALESCE((gs.state_json->>'bossDamageMonth')::bigint, 0)
					ELSE COALESCE((gs.state_json->>'bossDamageAllTime')::bigint, 0)
				END AS damage_total
			FROM game_states gs
			JOIN users u ON u.id = gs.user_id
			ORDER BY damage_total DESC, lower(u.login) ASC
			LIMIT (:'limit')::int
		`, map[string]string{
			"period_type": period,
			"period_key":  periodKey,
			"limit":       fmt.Sprintf("%d", limit),
		})
		if err != nil {
			return nil, err
		}
		out = strings.TrimSpace(out)
	}
	if out == "" {
		return []leaderboardEntry{}, nil
	}
	lines := strings.Split(out, "\n")
	entries := make([]leaderboardEntry, 0, len(lines))
	for i, line := range lines {
		parts := strings.SplitN(line, "\t", 3)
		if len(parts) != 3 {
			continue
		}
		damage, _ := strconv.Atoi(strings.TrimSpace(parts[2]))
		entries = append(entries, leaderboardEntry{Place: i + 1, UserID: parts[0], Login: parts[1], Damage: damage})
	}
	return entries, nil
}

func (s *Server) processLeaderboardRewards(ctx context.Context) error {
	now := time.Now()
	for _, spec := range leaderboardRewardSpecs {
		periodKey := previousLeaderboardPeriodKey(spec.period, now)
		if periodKey == "" {
			continue
		}
		if s.leaderboardRewardAlreadyGranted(ctx, spec.period, periodKey) {
			continue
		}
		entries, err := s.leaderboardEntries(ctx, spec.period, periodKey, 1)
		if err != nil || len(entries) == 0 {
			continue
		}
		winner := entries[0]
		if err := s.grantLeaderboardReward(ctx, spec.period, periodKey, winner, spec.reward); err != nil {
			log.Printf("leaderboard reward failed for %s %s: %v", spec.period, periodKey, err)
		}
	}
	return nil
}

func (s *Server) leaderboardRewardAlreadyGranted(ctx context.Context, period, periodKey string) bool {
	if strings.TrimSpace(s.dbURL) == "" {
		var exists bool
		_ = s.withLocalStore(func(store *localStore) error {
			store.ensure()
			_, exists = store.LeaderboardRewards[leaderboardRewardKey(period, periodKey)]
			return nil
		})
		return exists
	}
	out, err := s.queryPSQL(ctx, `
		SELECT winner_user_id
		FROM leaderboard_reward_grants
		WHERE period_type = :'period_type' AND period_key = :'period_key'
		LIMIT 1
	`, map[string]string{"period_type": period, "period_key": periodKey})
	return err == nil && strings.TrimSpace(out) != ""
}

func (s *Server) grantLeaderboardReward(ctx context.Context, period, periodKey string, winner leaderboardEntry, reward map[Currency]int) error {
	if strings.TrimSpace(winner.UserID) == "" || len(reward) == 0 {
		return nil
	}
	state, err := s.loadState(ctx, winner.UserID)
	if err != nil {
		return err
	}
	for cur, amount := range reward {
		addCurrencyGain(&state, cur, amount)
	}
	appendLog(&state, fmt.Sprintf("Награда за лидера %s %s: %s получил награду.", period, periodKey, winner.Login))
	if err := s.saveState(ctx, winner.UserID, state); err != nil {
		return err
	}
	if strings.TrimSpace(s.dbURL) == "" {
		return s.withLocalStore(func(store *localStore) error {
			store.ensure()
			store.LeaderboardRewards[leaderboardRewardKey(period, periodKey)] = winner.UserID
			return nil
		})
	}
	return s.execPSQL(ctx, `
		INSERT INTO leaderboard_reward_grants (period_type, period_key, winner_user_id, winner_login, created_at)
		VALUES (:'period_type', :'period_key', :'winner_user_id', :'winner_login', NOW())
		ON CONFLICT (period_type, period_key) DO NOTHING
	`, map[string]string{
		"period_type":    period,
		"period_key":     periodKey,
		"winner_user_id": winner.UserID,
		"winner_login":   winner.Login,
	})
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

func addCurrencyGain(gs *GameState, cur Currency, amount int) {
	if gs == nil || amount <= 0 {
		return
	}
	if gs.Player.Currency == nil {
		gs.Player.Currency = map[Currency]int{}
	}
	gs.Player.Currency[cur] += amount
	if gs.EconomyTotals == nil {
		gs.EconomyTotals = map[Currency]int{}
	}
	gs.EconomyTotals[cur] += amount
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
