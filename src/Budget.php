<?php
declare(strict_types=1);

final class Budget {
    public static function month(mixed $v): string {
        if (!is_string($v) || !preg_match('/^(20\d{2})-(0[1-9]|1[0-2])$/D',$v)) throw new Problem('Укажите месяц в пределах 2000–2099 годов.');
        return $v;
    }
    public static function amount(mixed $v,bool $negative=false): int {
        if (!is_int($v) || abs($v)>100000000000 || (!$negative && $v<0)) throw new Problem('Укажите сумму до миллиарда рублей, с точностью до копейки.');
        return $v;
    }
    private static function kind(mixed $v): string {
        if (!in_array($v,['income','expense'],true)) throw new Problem('Выберите доход или расход.');return $v;
    }
    private static function category(array $b,mixed $id): array {
        if (!is_string($id) || !isset($b['categories'][$id])) throw new Problem('Выберите существующую категорию.');return $b['categories'][$id];
    }
    public static function record(string $collection,array $d,array $b): array {
        if ($collection==='categories') {
            $order=$d['order']??0; if (!is_int($order) || $order<0 || $order>10000) throw new Problem('Порядок категории должен быть от 0 до 10000.');
            if (!is_bool($d['archived']??false)) throw new Problem('Проверьте состояние категории.');
            return ['name'=>App::str($d['name']??null,70),'kind'=>self::kind($d['kind']??null),'order'=>$order,'archived'=>$d['archived']??false];
        }
        if ($collection==='months') {
            if (!is_bool($d['incomeComplete']??false)) throw new Problem('Проверьте отметку о доходах.');
            return ['month'=>self::month($d['month']??null),'openingBalance'=>isset($d['openingBalance'])?self::amount($d['openingBalance'],true):null,'incomeComplete'=>$d['incomeComplete']??false];
        }
        $cat=self::category($b,$d['categoryId']??null); $amount=self::amount($d['amount']??null);
        $r=['categoryId'=>$d['categoryId'],'amount'=>$amount];
        if ($collection==='templates') return $r+['targetAmount'=>isset($d['targetAmount'])?self::amount($d['targetAmount']):null,'description'=>App::str($d['description']??'',200,false)];
        $r['month']=self::month($d['month']??null);
        if ($collection==='plans') return $r;
        if ($amount===0) throw new Problem('Сумма операции должна быть больше нуля.');
        $date=$d['date']??null;
        if ($date!==null && (!is_string($date) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D',$date) || substr($date,0,7)!==$r['month'] || !checkdate((int)substr($date,5,2),(int)substr($date,8,2),(int)substr($date,0,4)))) throw new Problem('Дата операции должна существовать и относиться к выбранному месяцу.');
        return $r+['date'=>$date,'description'=>App::str($d['description']??'',500,false)];
    }
    public static function summary(array $b): array {
        $months=array_unique(array_merge(array_keys($b['months']),array_column($b['entries'],'month'),array_column($b['plans'],'month')));$out=[];
        foreach ($months as $m) $out[$m]=['income'=>0,'expense'=>0,'plannedIncome'=>0,'plannedExpense'=>0,'available'=>null,'difference'=>0,'incomeComplete'=>$b['months'][$m]['incomeComplete']??false,'openingBalance'=>$b['months'][$m]['openingBalance']??null];
        foreach (['entries','plans'] as $collection) foreach ($b[$collection] as $r) {
            $kind=$b['categories'][$r['categoryId']]['kind'];$key=$collection==='plans'?($kind==='income'?'plannedIncome':'plannedExpense'):$kind;
            $out[$r['month']][$key]+=$r['amount'];
        }
        foreach ($out as &$s) { $s['difference']=$s['income']-$s['expense']; if ($s['incomeComplete'] && $s['openingBalance']!==null) $s['available']=$s['openingBalance']+$s['difference']; }
        return $out;
    }
    public static function apply(array &$b,array $command,array $user): array {
        $type=$command['type']??'';$d=$command['data']??[];
        if (!is_array($d)) throw new Problem('Проверьте данные изменения.');
        $collections=['saveCategory'=>'categories','saveEntry'=>'entries','savePlan'=>'plans','saveMonth'=>'months','saveTemplate'=>'templates'];
        if (isset($collections[$type])) {
            $collection=$collections[$type];$id=$d['id']??null;
            if ($id!==null && (!is_string($id) || !isset($b[$collection][$id]))) throw new Problem('Запись уже удалена. Обновите бюджет.',409);
            $record=self::record($collection,$d,$b);
            if ($collection==='plans') $id=$record['month'].'_'.$record['categoryId'];
            if ($collection==='months') $id=$record['month'];
            $id??=App::id();$old=$b[$collection][$id]??null;
            if ($collection==='categories' && $old && $old['kind']!==$record['kind']) {
                foreach (['entries','plans','templates'] as $other) foreach ($b[$other] as $v) if ($v['categoryId']===$id) throw new Problem('Тип категории с данными менять нельзя. Создайте новую категорию.');
            }
            if (in_array($collection,['entries','plans','templates'],true) && !$old && $b['categories'][$record['categoryId']]['archived']) throw new Problem('Категория в архиве. Верните её в настройках или выберите другую.');
            $record+=['id'=>$id,'updatedAt'=>gmdate('c'),'updatedBy'=>$user['name']];
            foreach (['sourceKey','sourceRef','sourceNames'] as $field) if (isset($old[$field])) $record[$field]=$old[$field];
            $b[$collection][$id]=$record;return ['id'=>$id];
        }
        if (in_array($type,['deleteEntry','deletePlan','deleteTemplate'],true)) {
            $collection=['deleteEntry'=>'entries','deletePlan'=>'plans','deleteTemplate'=>'templates'][$type];$id=$d['id']??'';
            if (!is_string($id) || !isset($b[$collection][$id])) throw new Problem('Запись уже удалена. Обновите бюджет.',409);
            unset($b[$collection][$id]);return ['id'=>$id];
        }
        if ($type==='copyPlan' || $type==='useTemplate') {
            $target=self::month($d['month']??null);$replace=($d['replace']??false)===true;$count=0;
            if ($type==='copyPlan') {
                $from=self::month($d['from']??null);if ($from===$target) throw new Problem('Выберите другой месяц для копирования.');
                $rows=array_filter($b['plans'],fn($v)=>$v['month']===$from);
            } else $rows=$b['templates'];
            $amounts=[];
            foreach ($rows as $r) if (!$b['categories'][$r['categoryId']]['archived']) {
                $amount=$type==='useTemplate' && ($d['target']??false)===true?($r['targetAmount']??$r['amount']):$r['amount'];
                $amounts[$r['categoryId']]=($amounts[$r['categoryId']]??0)+$amount;
            }
            foreach ($amounts as $cat=>$amount) {
                $id=$target.'_'.$cat;if (!$replace && isset($b['plans'][$id])) continue;
                $b['plans'][$id]=self::record('plans',['month'=>$target,'categoryId'=>$cat,'amount'=>$amount],$b)+['id'=>$id,'updatedAt'=>gmdate('c'),'updatedBy'=>$user['name']];$count++;
            }
            if (!$count) throw new Problem('Нет новых строк для заполнения. Проверьте исходный план и выбранный месяц.');
            return ['count'=>$count];
        }
        if ($type==='undo') {
            $event=null;foreach ($b['history'] as $e) if ($e['id']===($d['id']??'')) $event=$e;
            if (!$event) throw new Problem('Изменение не найдено.');
            foreach ($event['changes'] as $c) if (($b[$c['collection']][$c['id']]??null)!==$c['after']) throw new Problem('Эти данные уже изменены ещё раз. Отмена перезаписала бы новую правку; отредактируйте запись вручную.',409);
            foreach ($event['changes'] as $c) { if ($c['before']===null) unset($b[$c['collection']][$c['id']]);else $b[$c['collection']][$c['id']]=$c['before']; }
            return ['undone'=>$event['id']];
        }
        throw new Problem('Такое изменение не поддерживается.');
    }
    public static function changes(array $before,array $after): array {
        $out=[];
        foreach (['categories','entries','plans','months','templates','imports'] as $collection) foreach (array_unique(array_merge(array_keys($before[$collection]),array_keys($after[$collection]))) as $id) {
            $a=$before[$collection][$id]??null;$b=$after[$collection][$id]??null;
            if ($a!==$b) $out[]=['collection'=>$collection,'id'=>(string)$id,'before'=>$a,'after'=>$b];
        }
        return $out;
    }
    public static function validate(array $b): void {
        $allowed=['categories','entries','plans','months','templates','imports','history'];
        foreach ($allowed as $c) if (!isset($b[$c]) || !is_array($b[$c])) throw new Problem('Копия повреждена: отсутствует раздел '.$c.'.');
        if (array_diff(array_keys($b),$allowed)) throw new Problem('Копия содержит неизвестные разделы.');
        if (count($b['entries'])>20000 || count($b['categories'])>500 || count($b['history'])>20000) throw new Problem('В копии слишком много записей для этой версии.');
        foreach (['categories','months','entries','plans','templates'] as $c) foreach ($b[$c] as $id=>$r) {
            if (!is_string($id) || strlen($id)>100 || !preg_match('/^[a-zA-Z0-9_-]+$/D',$id) || !is_array($r) || ($r['id']??null)!==$id) throw new Problem('Копия повреждена: неверный идентификатор записи.');
            self::record($c,$r,$b);
            if ($c==='plans' && $id!==$r['month'].'_'.$r['categoryId']) throw new Problem('В копии найден дубликат плана.');
            if ($c==='months' && $id!==$r['month']) throw new Problem('В копии неверный месяц.');
            foreach (['sourceKey','sourceRef','updatedAt','updatedBy'] as $f) if (isset($r[$f])) App::str($r[$f],250,false);
            if (isset($r['sourceNames'])) { if ($c!=='categories' || !is_array($r['sourceNames']) || count($r['sourceNames'])>100) throw new Problem('Повреждена привязка категории к источнику.');foreach ($r['sourceNames'] as $alias) App::str($alias,100); }
        }
        $sources=[];foreach (['entries','plans','templates'] as $c) foreach ($b[$c] as $r) if (isset($r['sourceKey'])) { if (isset($sources[$r['sourceKey']])) throw new Problem('В копии повторяется одна исходная ячейка.');$sources[$r['sourceKey']]=true; }
        foreach ($b['imports'] as $id=>$value) if (!is_string($id) || strlen($id)>250 || $value!==true) throw new Problem('В копии повреждены отметки импорта.');
        foreach ($b['history'] as $event) {
            if (!is_array($event) || !is_string($event['id']??null) || !is_string($event['at']??null) || !is_string($event['user']??null) || !is_string($event['action']??null) || !is_array($event['changes']??null)) throw new Problem('В копии повреждена история изменений.');
            foreach ($event['changes'] as $change) {
                if (!is_array($change) || !in_array($change['collection']??'',array_slice($allowed,0,6),true) || !is_string($change['id']??null) || strlen($change['id'])>250 || !array_key_exists('before',$change) || !array_key_exists('after',$change)) throw new Problem('В копии повреждено изменение.');
                foreach (['before','after'] as $f) if ($change[$f]!==null && ($change['collection']==='imports'?$change[$f]!==true:!is_array($change[$f]))) throw new Problem('В копии повреждена запись истории.');
            }
        }
    }
    public static function backup(mixed $data): array {
        if (!is_array($data) || ($data['format']??'')!=='family-budget' || ($data['version']??null)!==1 || !is_array($data['budget']??null)) throw new Problem('Выберите JSON-копию «Семейного плана» версии 1.');
        $b=$data['budget'];self::validate($b);if (strlen(App::json($b))>4500000) throw new Problem('Копия больше 4,5 МБ.',413);return $b;
    }
}
