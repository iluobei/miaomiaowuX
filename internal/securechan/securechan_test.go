package securechan

import (
	"crypto/ed25519"
	"crypto/rand"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadOrGenerate(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.key")

	id1, err := LoadOrGenerate(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(id1.PublicKey) != ed25519.PublicKeySize {
		t.Fatalf("bad public key size: %d", len(id1.PublicKey))
	}

	id2, err := LoadOrGenerate(path)
	if err != nil {
		t.Fatal(err)
	}
	if id1.PublicKeyBase64() != id2.PublicKeyBase64() {
		t.Fatal("reloaded key differs")
	}
}

func TestParsePublicKey(t *testing.T) {
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	id := &MasterIdentity{PrivateKey: priv, PublicKey: priv.Public().(ed25519.PublicKey)}

	pub, err := ParsePublicKey(id.PublicKeyBase64())
	if err != nil {
		t.Fatal(err)
	}
	if !pub.Equal(id.PublicKey) {
		t.Fatal("parsed key mismatch")
	}

	if _, err := ParsePublicKey("bad-base64!!!"); err == nil {
		t.Fatal("expected error for bad base64")
	}
}

func TestEphemeralAndECDH(t *testing.T) {
	aPriv, aPub, err := GenerateEphemeral()
	if err != nil {
		t.Fatal(err)
	}
	bPriv, bPub, err := GenerateEphemeral()
	if err != nil {
		t.Fatal(err)
	}

	secret1, err := ComputeSharedSecret(aPriv, bPub)
	if err != nil {
		t.Fatal(err)
	}
	secret2, err := ComputeSharedSecret(bPriv, aPub)
	if err != nil {
		t.Fatal(err)
	}

	if len(secret1) != 32 {
		t.Fatalf("bad shared secret size: %d", len(secret1))
	}
	for i := range secret1 {
		if secret1[i] != secret2[i] {
			t.Fatal("shared secrets differ")
		}
	}
}

func TestSignAndVerify(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	data := []byte("hello world")

	sig := Sign(priv, data)
	if !Verify(pub, data, sig) {
		t.Fatal("valid signature rejected")
	}
	if Verify(pub, []byte("tampered"), sig) {
		t.Fatal("tampered data accepted")
	}

	pub2, _, _ := ed25519.GenerateKey(rand.Reader)
	if Verify(pub2, data, sig) {
		t.Fatal("wrong key accepted")
	}
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	agentPriv, agentPub, _ := GenerateEphemeral()
	masterPriv, masterPub, _ := GenerateEphemeral()

	sharedA, _ := ComputeSharedSecret(agentPriv, masterPub)
	sharedM, _ := ComputeSharedSecret(masterPriv, agentPub)

	agentSession, err := DeriveSession(sharedA, agentPub, masterPub, false)
	if err != nil {
		t.Fatal(err)
	}
	masterSession, err := DeriveSession(sharedM, agentPub, masterPub, true)
	if err != nil {
		t.Fatal(err)
	}

	// Agent → Master
	plaintext := []byte(`{"type":"traffic","data":"test123"}`)
	envelope, err := agentSession.Encrypt(plaintext)
	if err != nil {
		t.Fatal(err)
	}
	if envelope[0] != EnvelopeVersion {
		t.Fatalf("bad version byte: %d", envelope[0])
	}

	decrypted, err := masterSession.Decrypt(envelope)
	if err != nil {
		t.Fatal(err)
	}
	if string(decrypted) != string(plaintext) {
		t.Fatalf("decrypted mismatch: %q vs %q", decrypted, plaintext)
	}

	// Master → Agent
	plaintext2 := []byte(`{"type":"limiter_config","servers":[]}`)
	envelope2, _ := masterSession.Encrypt(plaintext2)
	decrypted2, err := agentSession.Decrypt(envelope2)
	if err != nil {
		t.Fatal(err)
	}
	if string(decrypted2) != string(plaintext2) {
		t.Fatal("reverse direction mismatch")
	}
}

func TestTamperDetection(t *testing.T) {
	agentPriv, agentPub, _ := GenerateEphemeral()
	masterPriv, masterPub, _ := GenerateEphemeral()

	sharedA, _ := ComputeSharedSecret(agentPriv, masterPub)
	sharedM, _ := ComputeSharedSecret(masterPriv, agentPub)

	agentSession, _ := DeriveSession(sharedA, agentPub, masterPub, false)
	masterSession, _ := DeriveSession(sharedM, agentPub, masterPub, true)

	envelope, _ := agentSession.Encrypt([]byte("secret"))
	envelope[len(envelope)-1] ^= 0xFF // flip last byte

	if _, err := masterSession.Decrypt(envelope); err == nil {
		t.Fatal("tampered envelope accepted")
	}
}

func TestReplayRejection(t *testing.T) {
	agentPriv, agentPub, _ := GenerateEphemeral()
	masterPriv, masterPub, _ := GenerateEphemeral()

	sharedA, _ := ComputeSharedSecret(agentPriv, masterPub)
	sharedM, _ := ComputeSharedSecret(masterPriv, agentPub)

	agentSession, _ := DeriveSession(sharedA, agentPub, masterPub, false)
	masterSession, _ := DeriveSession(sharedM, agentPub, masterPub, true)

	envelope, _ := agentSession.Encrypt([]byte("msg1"))
	if _, err := masterSession.Decrypt(envelope); err != nil {
		t.Fatal(err)
	}
	if _, err := masterSession.Decrypt(envelope); err == nil {
		t.Fatal("replay accepted")
	}
}

func TestWrongKeyRejection(t *testing.T) {
	agentPriv, agentPub, _ := GenerateEphemeral()
	_, masterPub, _ := GenerateEphemeral()

	sharedA, _ := ComputeSharedSecret(agentPriv, masterPub)

	agentSession, _ := DeriveSession(sharedA, agentPub, masterPub, false)

	// Create a completely different session
	wrongPriv, wrongPub, _ := GenerateEphemeral()
	_, otherPub, _ := GenerateEphemeral()
	sharedW, _ := ComputeSharedSecret(wrongPriv, otherPub)
	wrongSession, _ := DeriveSession(sharedW, wrongPub, otherPub, true)

	envelope, _ := agentSession.Encrypt([]byte("secret"))
	if _, err := wrongSession.Decrypt(envelope); err == nil {
		t.Fatal("wrong key accepted")
	}
}

func TestReplayWindow(t *testing.T) {
	var w replayWindow

	if w.Check(0) {
		t.Fatal("seq 0 should be rejected")
	}
	if !w.Check(1) {
		t.Fatal("seq 1 should be accepted")
	}
	if w.Check(1) {
		t.Fatal("seq 1 replay should be rejected")
	}
	if !w.Check(2) {
		t.Fatal("seq 2 should be accepted")
	}

	// Jump ahead
	if !w.Check(100) {
		t.Fatal("seq 100 should be accepted")
	}
	// Old seq within window
	if !w.Check(100 - windowSize + 1) {
		t.Fatalf("seq %d should be within window", 100-windowSize+1)
	}
	// Old seq outside window
	if w.Check(100 - windowSize) {
		t.Fatal("seq outside window should be rejected")
	}
}

func TestSessionCache(t *testing.T) {
	cache := NewSessionCache(100 * time.Millisecond)

	agentPriv, agentPub, _ := GenerateEphemeral()
	masterPriv, masterPub, _ := GenerateEphemeral()
	shared, _ := ComputeSharedSecret(agentPriv, masterPub)
	_ = masterPriv

	session, _ := DeriveSession(shared, agentPub, masterPub, true)
	cache.Set("token1", session)

	if s := cache.Get("token1"); s == nil {
		t.Fatal("expected session from cache")
	}
	if s := cache.Get("token2"); s != nil {
		t.Fatal("expected nil for unknown token")
	}

	time.Sleep(150 * time.Millisecond)
	if s := cache.Get("token1"); s != nil {
		t.Fatal("expected expired session to be nil")
	}

	cache.Set("token3", session)
	cache.Delete("token3")
	if s := cache.Get("token3"); s != nil {
		t.Fatal("expected deleted session to be nil")
	}
}

func TestEnvelopeTooShort(t *testing.T) {
	agentPriv, agentPub, _ := GenerateEphemeral()
	masterPriv, masterPub, _ := GenerateEphemeral()
	sharedM, _ := ComputeSharedSecret(masterPriv, agentPub)
	_ = agentPriv

	masterSession, _ := DeriveSession(sharedM, agentPub, masterPub, true)

	if _, err := masterSession.Decrypt([]byte{0x01, 0x00}); err == nil {
		t.Fatal("expected error for short envelope")
	}
}

func TestUnknownVersion(t *testing.T) {
	agentPriv, agentPub, _ := GenerateEphemeral()
	masterPriv, masterPub, _ := GenerateEphemeral()
	sharedA, _ := ComputeSharedSecret(agentPriv, masterPub)
	sharedM, _ := ComputeSharedSecret(masterPriv, agentPub)

	agentSession, _ := DeriveSession(sharedA, agentPub, masterPub, false)
	masterSession, _ := DeriveSession(sharedM, agentPub, masterPub, true)

	envelope, _ := agentSession.Encrypt([]byte("test"))
	envelope[0] = 0xFF

	if _, err := masterSession.Decrypt(envelope); err == nil {
		t.Fatal("expected error for unknown version")
	}
}

func TestMultipleMessages(t *testing.T) {
	agentPriv, agentPub, _ := GenerateEphemeral()
	masterPriv, masterPub, _ := GenerateEphemeral()

	sharedA, _ := ComputeSharedSecret(agentPriv, masterPub)
	sharedM, _ := ComputeSharedSecret(masterPriv, agentPub)

	agentSession, _ := DeriveSession(sharedA, agentPub, masterPub, false)
	masterSession, _ := DeriveSession(sharedM, agentPub, masterPub, true)

	for i := 0; i < 100; i++ {
		msg := []byte("message " + string(rune('A'+i%26)))
		env, err := agentSession.Encrypt(msg)
		if err != nil {
			t.Fatalf("encrypt %d: %v", i, err)
		}
		dec, err := masterSession.Decrypt(env)
		if err != nil {
			t.Fatalf("decrypt %d: %v", i, err)
		}
		if string(dec) != string(msg) {
			t.Fatalf("msg %d mismatch", i)
		}
	}
}

func TestLoadOrGenerateSubdir(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "sub", "deep", "test.key")

	id, err := LoadOrGenerate(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("key file not created")
	}
	_ = id
}
