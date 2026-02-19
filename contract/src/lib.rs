use near_sdk::near;

#[near(contract_state)]
#[derive(Default)]
pub struct Contract {}

#[near]
impl Contract {
    pub fn draw(&self) {
        // Minimal contract: accepts any args, does nothing.
        // The indexer reads the transaction args directly from the chain.
    }
}
