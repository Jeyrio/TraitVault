-- TraitVault Database Schema

-- Collections table
CREATE TABLE collections (
  id SERIAL PRIMARY KEY,
  contract_address VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  total_supply INTEGER DEFAULT 0,
  total_volume DECIMAL(20, 6) DEFAULT 0,
  floor_price DECIMAL(20, 6),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- NFTs table
CREATE TABLE nfts (
  id SERIAL PRIMARY KEY,
  collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
  token_id INTEGER NOT NULL,
  owner_address VARCHAR(100) NOT NULL,
  metadata_uri TEXT,
  rarity_score DECIMAL(10, 2),
  rarity_rank INTEGER,
  minted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_sale_price DECIMAL(20, 6),
  UNIQUE(collection_id, token_id)
);

-- Traits table
CREATE TABLE traits (
  id SERIAL PRIMARY KEY,
  nft_id INTEGER REFERENCES nfts(id) ON DELETE CASCADE,
  trait_type VARCHAR(100) NOT NULL,
  trait_value VARCHAR(100) NOT NULL,
  rarity_score DECIMAL(10, 2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Transactions table
CREATE TABLE transactions (
  id SERIAL PRIMARY KEY,
  nft_id INTEGER REFERENCES nfts(id) ON DELETE CASCADE,
  tx_hash VARCHAR(100) UNIQUE NOT NULL,
  tx_type VARCHAR(20) NOT NULL, -- 'mint', 'transfer', 'sale'
  from_address VARCHAR(100),
  to_address VARCHAR(100) NOT NULL,
  price DECIMAL(20, 6),
  block_height INTEGER NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Holders table (aggregated view)
CREATE TABLE holders (
  id SERIAL PRIMARY KEY,
  collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
  holder_address VARCHAR(100) NOT NULL,
  nft_count INTEGER DEFAULT 0,
  total_value DECIMAL(20, 6) DEFAULT 0,
  first_acquired_at TIMESTAMP,
  last_acquired_at TIMESTAMP,
  UNIQUE(collection_id, holder_address)
);

-- Trait statistics table
CREATE TABLE trait_statistics (
  id SERIAL PRIMARY KEY,
  collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
  trait_type VARCHAR(100) NOT NULL,
  trait_value VARCHAR(100) NOT NULL,
  count INTEGER DEFAULT 0,
  rarity_score DECIMAL(10, 2),
  floor_price DECIMAL(20, 6),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(collection_id, trait_type, trait_value)
);

-- Indexes for performance
CREATE INDEX idx_nfts_collection ON nfts(collection_id);
CREATE INDEX idx_nfts_owner ON nfts(owner_address);
CREATE INDEX idx_nfts_rarity_rank ON nfts(rarity_rank);
CREATE INDEX idx_traits_nft ON traits(nft_id);
CREATE INDEX idx_traits_type_value ON traits(trait_type, trait_value);
CREATE INDEX idx_transactions_nft ON transactions(nft_id);
CREATE INDEX idx_transactions_type ON transactions(tx_type);
CREATE INDEX idx_transactions_timestamp ON transactions(timestamp);
CREATE INDEX idx_holders_collection ON holders(collection_id);
CREATE INDEX idx_holders_count ON holders(nft_count DESC);
CREATE INDEX idx_trait_stats_collection ON trait_statistics(collection_id);

-- Function to update collection stats
CREATE OR REPLACE FUNCTION update_collection_stats()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE collections
  SET 
    total_supply = (SELECT COUNT(*) FROM nfts WHERE collection_id = NEW.collection_id),
    updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.collection_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-updating collection stats
CREATE TRIGGER trigger_update_collection_stats
AFTER INSERT OR UPDATE OR DELETE ON nfts
FOR EACH ROW
EXECUTE FUNCTION update_collection_stats();

-- Function to update holder counts
CREATE OR REPLACE FUNCTION update_holder_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- Update old owner if exists
  IF OLD.owner_address IS NOT NULL THEN
    UPDATE holders
    SET 
      nft_count = (
        SELECT COUNT(*) 
        FROM nfts 
        WHERE collection_id = OLD.collection_id 
        AND owner_address = OLD.owner_address
      )
    WHERE collection_id = OLD.collection_id 
    AND holder_address = OLD.owner_address;
  END IF;
  
  -- Update new owner
  INSERT INTO holders (collection_id, holder_address, nft_count, first_acquired_at, last_acquired_at)
  VALUES (
    NEW.collection_id, 
    NEW.owner_address, 
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT (collection_id, holder_address)
  DO UPDATE SET
    nft_count = (
      SELECT COUNT(*) 
      FROM nfts 
      WHERE collection_id = NEW.collection_id 
      AND owner_address = NEW.owner_address
    ),
    last_acquired_at = CURRENT_TIMESTAMP;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-updating holder stats
CREATE TRIGGER trigger_update_holder_stats
AFTER INSERT OR UPDATE ON nfts
FOR EACH ROW
EXECUTE FUNCTION update_holder_stats();