-- CFSC Mutual Aid App - Seed Data
-- Run after schema.sql to populate reference data.

-- ============================================================
-- Food Categories (CFSC weight table, based on GCFD standards)
-- ============================================================
INSERT INTO food_categories (gcfd_category, aldi_term, avg_lbs, examples, keywords, sort_order) VALUES
  ('Bread/Bakery', 'Bread', 15, 'Bread, bakery, pastries',
   ARRAY['bread', 'bakery', 'pastry', 'pastries', 'roll', 'rolls', 'bun', 'buns', 'bagel', 'bagels', 'tortilla', 'tortillas', 'muffin', 'muffins', 'donut', 'donuts', 'cake', 'croissant', 'baked goods', 'cookie', 'cookies', 'pie'], 1),

  ('Produce', 'Produce', 25, 'Fruits and vegetables',
   ARRAY['apple', 'apples', 'banana', 'bananas', 'orange', 'oranges', 'potato', 'potatoes', 'tomato', 'tomatoes', 'carrot', 'carrots', 'lettuce', 'broccoli', 'spinach', 'grape', 'grapes', 'berry', 'berries', 'melon', 'vegetable', 'vegetables', 'fruit', 'fruits', 'produce', 'salad', 'greens', 'celery', 'pepper', 'peppers', 'cucumber', 'cucumbers', 'onion', 'onions', 'squash', 'kale', 'avocado', 'mushroom', 'mushrooms', 'corn', 'cabbage', 'herbs', 'lemon', 'lemons', 'lime', 'limes', 'mango', 'pear', 'pears', 'peach', 'peaches', 'plum', 'plums', 'radish', 'beet', 'beets', 'turnip', 'eggplant', 'asparagus', 'artichoke', 'pineapple'], 2),

  ('Non-Food', 'Non-Food', 25, 'Toilet paper, hygiene products, clothing, toys, textiles',
   ARRAY['toilet paper', 'hygiene', 'clothing', 'toys', 'textiles', 'paper towel', 'paper towels', 'soap', 'shampoo', 'diaper', 'diapers', 'wipes', 'sanitizer', 'gloves', 'masks', 'tissue', 'non-food', 'baby wipes', 'hand soap', 'hand sanitizer', 'glade', 'cascade'], 3),

  ('Dairy', 'Dairy', 40, 'Milk, oat milk, almond milk, soy milk, creamer',
   ARRAY['milk', 'oat milk', 'almond milk', 'soy milk', 'creamer', 'half and half', 'coconut milk', 'protein shake'], 4),

  ('Beverages', 'Drinks', 35, 'Water, juice, soda, tea, coffee, other drinks',
   ARRAY['water', 'juice', 'soda', 'soft drink', 'coffee', 'tea', 'beverage', 'drink', 'drinks', 'kombucha', 'lemonade', 'gatorade', 'lacroix', 'sparkling water', 'seltzer', 'pop', 'cola', 'pepsi', 'vitamin water', 'flavored water', 'ice tea', 'iced tea', 'energy drink', 'coconut water'], 5),

  ('Grocery', 'Assorted Dry', 25, 'Dry foods',
   ARRAY['dry', 'cereal', 'pasta', 'rice', 'flour', 'sugar', 'bean', 'beans', 'lentil', 'lentils', 'canned', 'soup', 'sauce', 'oil', 'spice', 'condiment', 'grocery', 'oatmeal', 'oats', 'grits', 'noodles', 'crackers', 'chips', 'snacks', 'peanut butter', 'jelly', 'ramen', 'mac and cheese', 'pantry', 'shelf stable', 'granola', 'popcorn', 'pretzels', 'cans', 'dried', 'stuffing', 'ketchup', 'salsa', 'seasoning'], 6),

  ('Deli/Prepared', 'Assorted Cooler', 30, 'Eggs, yogurt, cheese, deli meats and other deli foods, anything refrigerated',
   ARRAY['egg', 'eggs', 'yogurt', 'cheese', 'deli', 'prepared', 'refrigerated', 'hummus', 'cream cheese', 'butter', 'cream', 'lunch meat', 'ham', 'sausage', 'hot dog', 'hot dogs', 'sandwich', 'sandwiches', 'salad kit', 'salad kits', 'dip', 'guacamole', 'prepared meals', 'gyros', 'breakfast'], 7),

  ('Meat', 'Meat', 45, 'Meat, fish, seafood (all will be frozen by CFSC or immediately distributed)',
   ARRAY['chicken', 'beef', 'pork', 'turkey', 'meat', 'meats', 'fish', 'seafood', 'salmon', 'bacon', 'ground beef', 'steak', 'tuna', 'shrimp', 'lamb', 'ribs', 'thigh', 'breast', 'wing'], 8),

  ('Assorted Freezer', 'Assorted Freezer', 25, 'Ice cream, frozen bread, pizzas',
   ARRAY['frozen', 'ice cream', 'pizza', 'pizzas', 'waffle', 'waffles', 'frozen bread', 'frozen meat', 'frozen chicken', 'frozen meals', 'frozen foods', 'frozen goods', 'popsicle', 'freeze', 'freezer'], 9);

-- ============================================================
-- Locations (rescue sources) — with addresses from signup.com
-- ============================================================
INSERT INTO locations (name, type, address, aliases) VALUES
  ('Aldi Belmont', 'rescue', '3320 W Belmont Ave, Chicago, IL 60618', ARRAY['aldi belmont', 'belmont aldi', 'aldi avondale', 'avondale aldi']),
  ('Aldi Cicero', 'rescue', NULL, ARRAY['aldi cicero']),
  ('Aldi Englewood', 'rescue', NULL, ARRAY['aldi englewood']),
  ('Aldi Hodgkins', 'rescue', NULL, ARRAY['aldi hodgkins']),
  ('Aldi Kostner', 'rescue', '1440 N Kostner Ave, Chicago, IL 60651', ARRAY['aldi kostner', 'kostner aldi']),
  ('Aldi Lyons', 'rescue', NULL, ARRAY['aldi lyons']),
  ('Aldi Wicker Park', 'rescue', '1753 N Milwaukee Ave, Chicago, IL 60647', ARRAY['aldi wp', 'wp aldi', 'aldi wicker park', 'wicker park aldi', 'aldi n milwaukee', 'aldis wp', 'aldis wicker park']),
  ('Avondale Mutual Aid', 'drop_off', NULL, ARRAY['avondale', 'avondale mutual aid', 'avondale took']),
  ('BKMA', 'drop_off', NULL, ARRAY['bkma', 'back of the yards']),
  ('BYP', 'drop_off', NULL, ARRAY['byp']),
  ('Cold Chain', 'rescue', NULL, ARRAY['cold chain']),
  ('Costco', 'rescue', NULL, ARRAY['costco']),
  ('Edgewater Mutual Aid', 'drop_off', NULL, ARRAY['edgewater mutual aid', 'eman']),
  ('Fresh Thyme', 'rescue', NULL, ARRAY['fresh thyme']),
  ('Imperfect', 'rescue', '575 Northwest Ave, Northlake, IL 60164', ARRAY['imperfect', 'imperfect foods', 'misfits market']),
  ('Irving Park Food Pantry', 'rescue', '4256 N Ridgeway Ave, Chicago, IL 60618', ARRAY['ipcfp', 'irving park pantry', 'irving park food pantry']),
  ('Jewel', 'rescue', NULL, ARRAY['jewel', 'jewel osco']),
  ('Just Roots', 'rescue', NULL, ARRAY['just roots']),
  ('Local Foods', 'rescue', '7424 S Lockwood Ave, Chicago, IL 60638', ARRAY['local foods']),
  ('Love Fridge', 'both', NULL, ARRAY['love fridge', 'love fridges', 'love fridge took', 'la michoacana']),
  ('LSRSN', 'drop_off', NULL, ARRAY['lsrsn', 'ls rsn']),
  ('Mariano''s', 'rescue', NULL, ARRAY['marianos', 'mariano''s']),
  ('Mariano''s South Loop', 'rescue', '1615 S Clark St, Chicago, IL 60616', ARRAY['sl mariano''s', 'marianos sl', 'mariano''s sl', 'marianos south loop', 'south loop marianos', 'south loop mariano''s', 'sl marianos']),
  ('Marillac', 'drop_off', NULL, ARRAY['marillac']),
  ('NA4J', 'drop_off', NULL, ARRAY['na4j']),
  ('New Hope', 'rescue', NULL, ARRAY['new hope', 'new hope pantry']),
  ('New Life Albany Park', 'rescue', '4540 N Hamlin Ave, Chicago, IL 60625', ARRAY['new life', 'new life gap', 'new life albany park']),
  ('Pete''s', 'rescue', NULL, ARRAY['petes', 'pete''s', 'pete''s fresh market']),
  ('Pilsen Food Pantry', 'drop_off', NULL, ARRAY['pilsen food pantry', 'pilsen pantry', 'pfp']),
  ('Port Ministries', 'drop_off', NULL, ARRAY['port ministries', 'port &', 'port and']),
  ('PSN', 'drop_off', NULL, ARRAY['psn', 'pilsen solidarity network']),
  ('San Lucas', 'rescue', '2914 W North Ave, Chicago, IL 60647', ARRAY['san lucas', 'san lucas church']),
  ('Sweet Water Foundation', 'drop_off', NULL, ARRAY['sweet water foundation', 'sweet water', 'sweetwater']),
  ('SWC', 'drop_off', NULL, ARRAY['swc', 'swc took']),
  ('Sysco', 'rescue', NULL, ARRAY['sysco']),
  ('Target', 'rescue', NULL, ARRAY['target']),
  ('The Bagelers', 'rescue', '2461 N Lincoln Ave, Chicago, IL 60614', ARRAY['the bagelers', 'bagelers']),
  ('Trader Joe''s', 'rescue', NULL, ARRAY['trader joes', 'trader joe''s', 'trader joe', 'tj''s']),
  ('Whole Foods', 'rescue', '3201 N Ashland Ave, Chicago, IL 60657', ARRAY['whole foods', 'englewood whole foods', 'wf']),
  ('Above & Beyond', 'rescue', '817 S Pulaski Rd, Chicago, IL 60624', ARRAY['above and beyond', 'above & beyond', 'a&b']),
  ('WSMA', 'drop_off', NULL, ARRAY['wsma', 'west side mutual aid']);

-- Warehouse / drop-off locations
INSERT INTO locations (name, type, address, aliases) VALUES
  ('Keystone', 'drop_off', '2311 Keystone Ave, Chicago, IL 60639', ARRAY['keystone', '2311 keystone']),
  ('NWMA', 'drop_off', NULL, ARRAY['nwma', 'northwest mutual aid']),
  ('Urban Canopy', 'drop_off', NULL, ARRAY['uc', 'urban canopy']);

-- ============================================================
-- Recurring Weekly Pickup Events (from signup.com schedule)
-- day_of_week: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
-- ============================================================

-- MONDAY (day_of_week = 1)
INSERT INTO pickup_events (name, address, day_of_week, start_time, end_time, capacity, notes, location_id)
VALUES
  ('Aldi Kostner', '1440 N Kostner Ave, Chicago, IL 60651', 1, '09:00', '19:00', 1, NULL,
    (SELECT id FROM locations WHERE name = 'Aldi Kostner')),
  ('Aldi Wicker Park', '1753 N Milwaukee Ave, Chicago, IL 60647', 1, '09:00', '19:00', 1, NULL,
    (SELECT id FROM locations WHERE name = 'Aldi Wicker Park')),
  ('Aldi Avondale', '3320 W Belmont Ave, Chicago, IL 60618', 1, '10:00', '12:00', 1, NULL,
    (SELECT id FROM locations WHERE name = 'Aldi Belmont')),
  ('Keystone Food Delivery', '2311 Keystone Ave, Chicago, IL 60639', 1, '12:00', '12:30', 2, NULL,
    (SELECT id FROM locations WHERE name = 'Keystone')),
  ('The Bagelers', '2461 N Lincoln Ave, Chicago, IL 60614', 1, '15:00', '16:00', 1, NULL,
    (SELECT id FROM locations WHERE name = 'The Bagelers'));

-- TUESDAY (day_of_week = 2)
INSERT INTO pickup_events (name, address, day_of_week, start_time, end_time, capacity, notes, location_id)
VALUES
  ('New Hope Pantry', NULL, 2, '12:00', '12:30', 2, '2 cars needed',
    (SELECT id FROM locations WHERE name = 'New Hope')),
  ('New Life Albany Park', '4540 N Hamlin Ave, Chicago, IL 60625', 2, '17:30', '18:00', 3, NULL,
    (SELECT id FROM locations WHERE name = 'New Life Albany Park'));

-- WEDNESDAY (day_of_week = 3)
INSERT INTO pickup_events (name, address, day_of_week, start_time, end_time, capacity, notes, location_id)
VALUES
  ('Local Foods', '7424 S Lockwood Ave, Chicago, IL 60638', 3, '08:00', '14:00', 1, NULL,
    (SELECT id FROM locations WHERE name = 'Local Foods')),
  ('Irving Park Pantry', '4256 N Ridgeway Ave, Chicago, IL 60618', 3, '12:00', '13:00', 2, NULL,
    (SELECT id FROM locations WHERE name = 'Irving Park Food Pantry')),
  ('The Bagelers', '2461 N Lincoln Ave, Chicago, IL 60614', 3, '15:00', '16:00', 1, NULL,
    (SELECT id FROM locations WHERE name = 'The Bagelers'));

-- THURSDAY (day_of_week = 4)
INSERT INTO pickup_events (name, address, day_of_week, start_time, end_time, capacity, notes, location_id)
VALUES
  ('Whole Foods', '3201 N Ashland Ave, Chicago, IL 60657', 4, '08:00', '12:00', 1, NULL,
    (SELECT id FROM locations WHERE name = 'Whole Foods')),
  ('Aldi Wicker Park', '1753 N Milwaukee Ave, Chicago, IL 60647', 4, '09:00', '20:00', 1, NULL,
    (SELECT id FROM locations WHERE name = 'Aldi Wicker Park')),
  ('Aldi Avondale', '3320 W Belmont Ave, Chicago, IL 60618', 4, '10:00', '12:00', 1, NULL,
    (SELECT id FROM locations WHERE name = 'Aldi Belmont')),
  ('San Lucas Church', '2914 W North Ave, Chicago, IL 60647', 4, '10:00', '15:00', 1, NULL,
    (SELECT id FROM locations WHERE name = 'San Lucas')),
  ('Mariano''s South Loop', '1615 S Clark St, Chicago, IL 60616', 4, '11:00', '12:00', 1, NULL,
    (SELECT id FROM locations WHERE name = 'Mariano''s South Loop')),
  ('Move Food: Keystone to UC', '2311 Keystone Ave, Chicago, IL 60639', 4, '16:00', '18:30', 1, 'Move rescued food from Keystone warehouse to Urban Canopy',
    (SELECT id FROM locations WHERE name = 'Keystone')),
  ('Inventory in West Pilsen', NULL, 4, '18:00', '19:30', 1, 'Warehouse inventory check', NULL);

-- FRIDAY (day_of_week = 5)
INSERT INTO pickup_events (name, address, day_of_week, start_time, end_time, capacity, notes, location_id)
VALUES
  ('Aldi Kostner', '1440 N Kostner Ave, Chicago, IL 60651', 5, '08:00', '18:00', 1, NULL,
    (SELECT id FROM locations WHERE name = 'Aldi Kostner')),
  ('Imperfect Foods', '575 Northwest Ave, Northlake, IL 60164', 5, '08:00', '09:00', 1, NULL,
    (SELECT id FROM locations WHERE name = 'Imperfect')),
  ('Above & Beyond Pantry', '817 S Pulaski Rd, Chicago, IL 60624', 5, '13:30', '15:00', 1, NULL,
    (SELECT id FROM locations WHERE name = 'Above & Beyond'));

-- SATURDAY (day_of_week = 6)
INSERT INTO pickup_events (name, address, day_of_week, start_time, end_time, capacity, notes, location_id)
VALUES
  ('Mariano''s South Loop', '1615 S Clark St, Chicago, IL 60616', 6, '06:00', '13:00', 1, NULL,
    (SELECT id FROM locations WHERE name = 'Mariano''s South Loop')),
  ('Aldi Avondale', '3320 W Belmont Ave, Chicago, IL 60618', 6, '10:00', '12:00', 1, NULL,
    (SELECT id FROM locations WHERE name = 'Aldi Belmont'));
