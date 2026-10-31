<?php
// Copy to config.php outside the web root and fill in the hosting database details.
// Replace installKey with a random value: php -r "echo bin2hex(random_bytes(32));"
return [
    'dsn'=>'mysql:host=localhost;dbname=YOUR_DATABASE;charset=utf8mb4',
    'dbUser'=>'YOUR_DATABASE_USER',
    'dbPassword'=>'YOUR_DATABASE_PASSWORD',
    'installKey'=>'REPLACE_WITH_64_RANDOM_HEX_CHARACTERS',
    'secure'=>true,
    'privateDir'=>__DIR__,
    'tablePrefix'=>'family_',
];
