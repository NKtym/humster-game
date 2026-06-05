package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type localSessionRecord struct {
	UserID    string    `json:"userId"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type localStore struct {
	Users          map[string]userRecord         `json:"users"`
	States         map[string]GameState          `json:"states"`
	Sessions       map[string]localSessionRecord `json:"sessions"`
	Friends        map[string][]string           `json:"friends"`
	FriendRequests map[string][]string           `json:"friendRequests"`
}

func (s *Server) localStorePath() string {
	if strings.TrimSpace(s.localPath) == "" {
		return "data/local_store.json"
	}
	return s.localPath
}

func (store *localStore) ensure() {
	if store.Users == nil {
		store.Users = map[string]userRecord{}
	}
	if store.States == nil {
		store.States = map[string]GameState{}
	}
	if store.Sessions == nil {
		store.Sessions = map[string]localSessionRecord{}
	}
	if store.Friends == nil {
		store.Friends = map[string][]string{}
	}
	if store.FriendRequests == nil {
		store.FriendRequests = map[string][]string{}
	}
}

func (s *Server) loadLocalStoreLocked() (*localStore, error) {
	path := s.localStorePath()
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			store := &localStore{}
			store.ensure()
			return store, nil
		}
		return nil, err
	}
	var store localStore
	if err := json.Unmarshal(raw, &store); err != nil {
		return nil, err
	}
	store.ensure()
	return &store, nil
}

func (s *Server) saveLocalStoreLocked(store *localStore) error {
	store.ensure()
	path := s.localStorePath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o644)
}

func (s *Server) withLocalStore(fn func(*localStore) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	store, err := s.loadLocalStoreLocked()
	if err != nil {
		return err
	}
	if err := fn(store); err != nil {
		return err
	}
	return s.saveLocalStoreLocked(store)
}

func (s *Server) localUserIDForToken(token string) (string, bool) {
	var userID string
	if err := s.withLocalStore(func(store *localStore) error {
		store.ensure()
		key := sessionTokenHash(token)
		rec, ok := store.Sessions[key]
		if !ok {
			return errNoRows
		}
		if time.Now().UTC().After(rec.ExpiresAt.UTC()) {
			delete(store.Sessions, key)
			return errNoRows
		}
		userID = rec.UserID
		return nil
	}); err != nil {
		return "", false
	}
	if strings.TrimSpace(userID) == "" {
		return "", false
	}
	return userID, true
}
