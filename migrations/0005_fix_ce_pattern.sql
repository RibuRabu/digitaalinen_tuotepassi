-- Fix GPSR_CE_MARKING_INFO doc_name_pattern: remove (?i) prefix which is not
-- valid JavaScript RegExp syntax (V8 throws SyntaxError: Invalid group).
-- The 'i' flag is already passed as a constructor argument in compliance.js,
-- so the prefix was redundant and harmful.
UPDATE regulation_rules
SET condition_json = '{"category_codes":["ELECTRONICS"],"doc_name_pattern":".*CE.*|.*conformity.*|.*declaration.*"}'
WHERE rule_code = 'GPSR_CE_MARKING_INFO';
