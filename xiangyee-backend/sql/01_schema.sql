CREATE DATABASE IF NOT EXISTS xiangyee_db;
USE xiangyee_db;

-- MENU ITEMS
CREATE TABLE IF NOT EXISTS menu_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name_cn VARCHAR(100) NOT NULL,
  name_en VARCHAR(150) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'Main Dishes',
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  image_url VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ORDERS
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_name VARCHAR(100) NOT NULL,
  customer_phone VARCHAR(30) NOT NULL,
  order_type ENUM('dine_in','takeaway') NOT NULL DEFAULT 'takeaway',
  table_no VARCHAR(20) NULL,
  notes TEXT NULL,
  status ENUM('pending','confirmed','preparing','ready','completed','cancelled')
    NOT NULL DEFAULT 'pending',
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ORDER ITEMS
CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  menu_item_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  line_total DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
);

-- RESERVATIONS
CREATE TABLE IF NOT EXISTS reservations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_name VARCHAR(100) NOT NULL,
  customer_phone VARCHAR(30) NOT NULL,
  reservation_date DATE NOT NULL,
  reservation_time TIME NOT NULL,
  pax INT NOT NULL,
  notes TEXT NULL,
  status ENUM('pending','confirmed','seated','completed','cancelled')
    NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
