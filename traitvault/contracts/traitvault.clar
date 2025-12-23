;; TraitVault NFT Collection - Stacks Punks
;; SIP-009 compliant NFT with traits

;; Define the NFT
(define-non-fungible-token stacks-punk uint)

;; Constants
(define-constant contract-owner tx-sender)
(define-constant err-owner-only (err u100))
(define-constant err-not-token-owner (err u101))
(define-constant err-mint-limit (err u102))
(define-constant err-already-minted (err u103))

;; Data vars
(define-data-var last-token-id uint u0)
(define-data-var mint-price uint u1000000) ;; 1 STX in microSTX
(define-data-var max-supply uint u10000)

;; Data maps
(define-map token-uris uint (string-ascii 256))
(define-map token-traits 
  uint 
  {
    background: (string-ascii 20),
    type: (string-ascii 20),
    mouth: (string-ascii 20),
    eyes: (string-ascii 20),
    accessory: (string-ascii 20)
  }
)

;; SIP-009 Functions

(define-read-only (get-last-token-id)
  (ok (var-get last-token-id))
)

(define-read-only (get-token-uri (token-id uint))
  (ok (map-get? token-uris token-id))
)

(define-read-only (get-owner (token-id uint))
  (ok (nft-get-owner? stacks-punk token-id))
)

;; Transfer function
(define-public (transfer (token-id uint) (sender principal) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender sender) err-not-token-owner)
    (nft-transfer? stacks-punk token-id sender recipient)
  )
)

;; Mint function with traits
(define-public (mint 
  (recipient principal)
  (uri (string-ascii 256))
  (background (string-ascii 20))
  (type-trait (string-ascii 20))
  (mouth (string-ascii 20))
  (eyes (string-ascii 20))
  (accessory (string-ascii 20))
)
  (let
    (
      (token-id (+ (var-get last-token-id) u1))
    )
    ;; Check supply limit
    (asserts! (<= token-id (var-get max-supply)) err-mint-limit)
    
    ;; Mint the NFT
    (try! (nft-mint? stacks-punk token-id recipient))
    
    ;; Store URI
    (map-set token-uris token-id uri)
    
    ;; Store traits
    (map-set token-traits token-id {
      background: background,
      type: type-trait,
      mouth: mouth,
      eyes: eyes,
      accessory: accessory
    })
    
    ;; Update last token ID
    (var-set last-token-id token-id)
    
    ;; Print event for chainhook
    (print {
      event: "mint",
      token-id: token-id,
      recipient: recipient,
      traits: {
        background: background,
        type: type-trait,
        mouth: mouth,
        eyes: eyes,
        accessory: accessory
      }
    })
    
    (ok token-id)
  )
)

;; Read-only functions

(define-read-only (get-token-traits (token-id uint))
  (map-get? token-traits token-id)
)

(define-read-only (get-mint-price)
  (ok (var-get mint-price))
)

(define-read-only (get-max-supply)
  (ok (var-get max-supply))
)

;; Admin functions

(define-public (set-mint-price (new-price uint))
  (begin
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    (ok (var-set mint-price new-price))
  )
)

(define-public (set-max-supply (new-supply uint))
  (begin
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    (ok (var-set max-supply new-supply))
  )
)