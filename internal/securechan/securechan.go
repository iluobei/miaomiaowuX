package securechan

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"

	"golang.org/x/crypto/curve25519"
	"golang.org/x/crypto/hkdf"
)

const (
	EnvelopeVersion = 0x01
	envelopeHeader  = 1 + 8 // version(1) + seq(8)
	gcmTagSize      = 16
	nonceSize       = 12
	windowSize      = 64
)

// MasterIdentity holds the Ed25519 long-term signing key.
type MasterIdentity struct {
	PrivateKey ed25519.PrivateKey
	PublicKey  ed25519.PublicKey
}

// LoadOrGenerate loads an Ed25519 key from path, or generates and saves one.
func LoadOrGenerate(path string) (*MasterIdentity, error) {
	data, err := os.ReadFile(path)
	if err == nil && len(data) == ed25519.SeedSize {
		priv := ed25519.NewKeyFromSeed(data)
		return &MasterIdentity{PrivateKey: priv, PublicKey: priv.Public().(ed25519.PublicKey)}, nil
	}

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate ed25519 key: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, fmt.Errorf("create key directory: %w", err)
	}
	if err := os.WriteFile(path, priv.Seed(), 0600); err != nil {
		return nil, fmt.Errorf("save key: %w", err)
	}

	return &MasterIdentity{PrivateKey: priv, PublicKey: pub}, nil
}

func (m *MasterIdentity) PublicKeyBase64() string {
	return base64.StdEncoding.EncodeToString(m.PublicKey)
}

func ParsePublicKey(b64 string) (ed25519.PublicKey, error) {
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, fmt.Errorf("decode public key: %w", err)
	}
	if len(data) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("invalid public key size: %d", len(data))
	}
	return ed25519.PublicKey(data), nil
}

// GenerateEphemeral creates an X25519 ephemeral key pair.
func GenerateEphemeral() (priv, pub []byte, err error) {
	priv = make([]byte, 32)
	if _, err = rand.Read(priv); err != nil {
		return nil, nil, err
	}
	pub, err = curve25519.X25519(priv, curve25519.Basepoint)
	if err != nil {
		return nil, nil, err
	}
	return priv, pub, nil
}

// ComputeSharedSecret performs X25519 ECDH.
func ComputeSharedSecret(myPriv, theirPub []byte) ([]byte, error) {
	return curve25519.X25519(myPriv, theirPub)
}

func Sign(privKey ed25519.PrivateKey, data []byte) []byte {
	return ed25519.Sign(privKey, data)
}

func Verify(pubKey ed25519.PublicKey, data, sig []byte) bool {
	return ed25519.Verify(pubKey, data, sig)
}

// Session holds directional AES-256-GCM ciphers for an established channel.
type Session struct {
	sendCipher cipher.AEAD
	recvCipher cipher.AEAD
	sendSeq    atomic.Uint64
	sendNonce  [nonceSize]byte
	recvNonce  [nonceSize]byte

	recvMu     sync.Mutex
	recvWindow replayWindow
}

// replayWindow is a sliding-window replay detector.
type replayWindow struct {
	maxSeq uint64
	bitmap uint64
}

func (w *replayWindow) Check(seq uint64) bool {
	if seq == 0 {
		return false
	}
	if seq > w.maxSeq {
		shift := seq - w.maxSeq
		if shift >= windowSize {
			w.bitmap = 0
		} else {
			w.bitmap <<= shift
		}
		w.maxSeq = seq
		w.bitmap |= 1
		return true
	}
	diff := w.maxSeq - seq
	if diff >= windowSize {
		return false
	}
	bit := uint64(1) << diff
	if w.bitmap&bit != 0 {
		return false
	}
	w.bitmap |= bit
	return true
}

// DeriveSession derives directional AES-256-GCM session keys from a shared secret.
// isMaster determines which direction gets which key.
func DeriveSession(sharedSecret, agentEphPub, masterEphPub []byte, isMaster bool) (*Session, error) {
	salt := make([]byte, 0, 64)
	salt = append(salt, agentEphPub...)
	salt = append(salt, masterEphPub...)

	hk := hkdf.New(sha256.New, sharedSecret, salt, []byte("securechan-v1"))

	var keys [4][]byte // sendKey, recvKey, sendNonce, recvNonce
	for i := range keys {
		keys[i] = make([]byte, 32)
		if i >= 2 {
			keys[i] = make([]byte, nonceSize)
		}
		if _, err := io.ReadFull(hk, keys[i]); err != nil {
			return nil, fmt.Errorf("hkdf read: %w", err)
		}
	}

	// HKDF outputs: masterToAgent key, agentToMaster key, masterToAgent nonce, agentToMaster nonce
	// Master sends with masterToAgent, receives with agentToMaster
	// Agent sends with agentToMaster, receives with masterToAgent
	m2aKey, a2mKey := keys[0], keys[1]
	m2aNonce, a2mNonce := keys[2], keys[3]

	var sendKey, recvKey []byte
	var sendNonce, recvNonce [nonceSize]byte

	if isMaster {
		sendKey, recvKey = m2aKey, a2mKey
		copy(sendNonce[:], m2aNonce)
		copy(recvNonce[:], a2mNonce)
	} else {
		sendKey, recvKey = a2mKey, m2aKey
		copy(sendNonce[:], a2mNonce)
		copy(recvNonce[:], m2aNonce)
	}

	sendBlock, err := aes.NewCipher(sendKey)
	if err != nil {
		return nil, err
	}
	sendCipher, err := cipher.NewGCM(sendBlock)
	if err != nil {
		return nil, err
	}

	recvBlock, err := aes.NewCipher(recvKey)
	if err != nil {
		return nil, err
	}
	recvCipher, err := cipher.NewGCM(recvBlock)
	if err != nil {
		return nil, err
	}

	return &Session{
		sendCipher: sendCipher,
		recvCipher: recvCipher,
		sendNonce:  sendNonce,
		recvNonce:  recvNonce,
	}, nil
}

// Encrypt produces a binary envelope: [version(1)][seq(8)][ciphertext+tag(16)]
func (s *Session) Encrypt(plaintext []byte) ([]byte, error) {
	seq := s.sendSeq.Add(1)

	nonce := makeNonce(s.sendNonce, seq)

	ciphertext := s.sendCipher.Seal(nil, nonce[:], plaintext, nil)

	out := make([]byte, envelopeHeader+len(ciphertext))
	out[0] = EnvelopeVersion
	binary.BigEndian.PutUint64(out[1:9], seq)
	copy(out[envelopeHeader:], ciphertext)

	return out, nil
}

// Decrypt parses a binary envelope and decrypts.
func (s *Session) Decrypt(envelope []byte) ([]byte, error) {
	if len(envelope) < envelopeHeader+gcmTagSize {
		return nil, errors.New("envelope too short")
	}
	if envelope[0] != EnvelopeVersion {
		return nil, fmt.Errorf("unknown envelope version: %d", envelope[0])
	}

	seq := binary.BigEndian.Uint64(envelope[1:9])

	s.recvMu.Lock()
	ok := s.recvWindow.Check(seq)
	s.recvMu.Unlock()
	if !ok {
		return nil, fmt.Errorf("replay or out-of-window seq: %d", seq)
	}

	nonce := makeNonce(s.recvNonce, seq)

	plaintext, err := s.recvCipher.Open(nil, nonce[:], envelope[envelopeHeader:], nil)
	if err != nil {
		return nil, fmt.Errorf("decrypt: %w", err)
	}

	return plaintext, nil
}

func makeNonce(base [nonceSize]byte, seq uint64) [nonceSize]byte {
	var nonce [nonceSize]byte
	copy(nonce[:], base[:])
	var seqBytes [nonceSize]byte
	binary.BigEndian.PutUint64(seqBytes[4:], seq)
	for i := range nonce {
		nonce[i] ^= seqBytes[i]
	}
	return nonce
}
