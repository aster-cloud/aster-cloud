/**
 * 策略输入值生成器
 *
 * 使用 aster-lang-ts 的类型推断引擎，根据字段名和类型自动生成有意义的示例输入值。
 */

import type { ParameterInfo, FieldInfo, TypeKind } from '@/services/policy/policy-api';

/**
 * 值生成规则接口
 */
interface ValueGenerationRule {
  pattern: RegExp;
  generate: () => unknown;
  priority: number;
}

/**
 * 金融领域值生成规则
 */
const FINANCIAL_RULES: ValueGenerationRule[] = [
  { pattern: /(?:credit|fico).*?score/i, generate: () => 720, priority: 10 },
  { pattern: /(?:loan|mortgage|principal).*?amount/i, generate: () => 50000.0, priority: 10 },
  { pattern: /(?:annual|monthly|yearly)?.*?(?:income|salary|earnings)/i, generate: () => 85000.0, priority: 9 },
  { pattern: /(?:monthly)?.*?(?:debt|obligation|payment)/i, generate: () => 1500.0, priority: 8 },
  { pattern: /(?:interest|apr|apy).*?rate/i, generate: () => 5.5, priority: 9 },
  { pattern: /(?:rate|interest)$/i, generate: () => 5.5, priority: 7 },
  { pattern: /(?:loan|term).*?(?:months?|years?|term)/i, generate: () => 36, priority: 9 },
  { pattern: /dti|debt.*?(?:to|income).*?ratio/i, generate: () => 0.35, priority: 10 },
  { pattern: /ltv|loan.*?(?:to|value).*?ratio/i, generate: () => 0.80, priority: 10 },
  // 中文金融字段
  { pattern: /信用评分|信用分/i, generate: () => 720, priority: 10 },
  { pattern: /贷款金额|申请金额/i, generate: () => 50000.0, priority: 10 },
  { pattern: /(?:年|月)?收入/i, generate: () => 85000.0, priority: 9 },
  { pattern: /负债/i, generate: () => 1500.0, priority: 8 },
  { pattern: /利率/i, generate: () => 5.5, priority: 9 },
  { pattern: /期限|贷款期/i, generate: () => 36, priority: 9 },
];

/**
 * 保险领域值生成规则
 */
const INSURANCE_RULES: ValueGenerationRule[] = [
  { pattern: /premium/i, generate: () => 1200, priority: 9 },
  { pattern: /deductible/i, generate: () => 500, priority: 9 },
  { pattern: /(?:coverage|policy).*?limit/i, generate: () => 100000, priority: 9 },
  { pattern: /(?:years?)?.*?licensed|driving.*?experience/i, generate: () => 8, priority: 8 },
  { pattern: /accident.*?(?:count|number)/i, generate: () => 0, priority: 8 },
  { pattern: /violation.*?(?:count|number)/i, generate: () => 1, priority: 8 },
  // 中文保险字段
  { pattern: /保费/i, generate: () => 1200, priority: 9 },
  { pattern: /免赔额/i, generate: () => 500, priority: 9 },
  { pattern: /保额|限额/i, generate: () => 100000, priority: 9 },
  { pattern: /驾龄/i, generate: () => 8, priority: 8 },
];

/**
 * 用户/个人信息值生成规则
 */
const PERSONAL_RULES: ValueGenerationRule[] = [
  { pattern: /^age$|.*?age$/i, generate: () => 35, priority: 10 },
  { pattern: /(?:applicant|customer|user|member|patient).*?id/i, generate: () => 'USR-2024-001', priority: 10 },
  { pattern: /(?:policy|claim|order|transaction).*?id/i, generate: () => 'POL-2024-001', priority: 10 },
  { pattern: /(?:id|identifier)$/i, generate: () => 'ID-001', priority: 6 },
  { pattern: /(?:applicant|customer|user|patient|member)?.*?name/i, generate: () => 'John Smith', priority: 8 },
  { pattern: /email/i, generate: () => 'john.smith@example.com', priority: 9 },
  { pattern: /phone|mobile|tel/i, generate: () => '+1-555-123-4567', priority: 9 },
  { pattern: /address/i, generate: () => '123 Main Street, Anytown, ST 12345', priority: 8 },
  // 中文个人信息字段
  { pattern: /^年龄$/i, generate: () => 35, priority: 10 },
  { pattern: /编号|标识符?/i, generate: () => 'ID-001', priority: 6 },
  { pattern: /姓名|名字/i, generate: () => '张三', priority: 8 },
  { pattern: /邮箱|电子邮件/i, generate: () => 'zhangsan@example.com', priority: 9 },
  { pattern: /电话|手机/i, generate: () => '13800138000', priority: 9 },
  { pattern: /地址/i, generate: () => '北京市朝阳区建国路100号', priority: 8 },
];

/**
 * 车辆信息值生成规则
 */
const VEHICLE_RULES: ValueGenerationRule[] = [
  { pattern: /(?:vehicle)?.*?make/i, generate: () => 'Toyota', priority: 9 },
  { pattern: /(?:vehicle)?.*?model/i, generate: () => 'Camry', priority: 9 },
  { pattern: /(?:vehicle|car).*?year/i, generate: () => 2022, priority: 9 },
  { pattern: /vin/i, generate: () => '1HGBH41JXMN109186', priority: 10 },
  { pattern: /mileage|odometer/i, generate: () => 35000, priority: 9 },
  // 中文车辆字段
  { pattern: /品牌/i, generate: () => '丰田', priority: 9 },
  { pattern: /型号/i, generate: () => '凯美瑞', priority: 9 },
  { pattern: /车辆年份/i, generate: () => 2022, priority: 9 },
  { pattern: /里程/i, generate: () => 35000, priority: 9 },
];

/**
 * 医疗健康领域值生成规则
 */
const HEALTHCARE_RULES: ValueGenerationRule[] = [
  { pattern: /patient.*?id/i, generate: () => 'PAT-2024-001', priority: 11 },
  { pattern: /(?:diagnosis|icd).*?code/i, generate: () => 'J06.9', priority: 10 },
  { pattern: /claim.*?amount/i, generate: () => 2500.0, priority: 10 },
  { pattern: /service.*?(?:type|code)/i, generate: () => 'OFFICE_VISIT', priority: 8 },
  { pattern: /provider.*?id/i, generate: () => 'PRV-001', priority: 9 },
  // 中文医疗字段
  { pattern: /患者.*?编号/i, generate: () => 'PAT-2024-001', priority: 11 },
  { pattern: /诊断代码/i, generate: () => 'J06.9', priority: 10 },
  { pattern: /索赔金额/i, generate: () => 2500.0, priority: 10 },
];

/**
 * 通用数值类型值生成规则
 */
const NUMERIC_RULES: ValueGenerationRule[] = [
  { pattern: /amount|price|cost|fee|total|balance|payment/i, generate: () => 1000.0, priority: 5 },
  { pattern: /percentage|ratio|percent/i, generate: () => 0.25, priority: 6 },
  { pattern: /count|number|qty|quantity/i, generate: () => 10, priority: 5 },
  { pattern: /score|rating|level|rank/i, generate: () => 85, priority: 5 },
  { pattern: /limit|max|min|threshold/i, generate: () => 1000, priority: 5 },
  // 中文通用数值字段
  { pattern: /金额|价格|费用|总计/i, generate: () => 1000.0, priority: 5 },
  { pattern: /百分比|比率/i, generate: () => 0.25, priority: 6 },
  { pattern: /数量|计数/i, generate: () => 10, priority: 5 },
  { pattern: /评分|等级/i, generate: () => 85, priority: 5 },
];

/**
 * 布尔类型值生成规则
 */
const BOOLEAN_RULES: ValueGenerationRule[] = [
  { pattern: /(?:is|has)?.*?(?:approved|verified|valid|active|enabled|confirmed)/i, generate: () => true, priority: 8 },
  { pattern: /(?:is|has)?.*?(?:rejected|denied|disabled|blocked|suspended)/i, generate: () => false, priority: 8 },
  { pattern: /^(?:has|is|can|should|does|did|will|was)/i, generate: () => true, priority: 6 },
  { pattern: /flag$/i, generate: () => true, priority: 5 },
  // 中文布尔字段
  { pattern: /已?(?:审批|验证|确认|激活|启用)/i, generate: () => true, priority: 8 },
  { pattern: /已?(?:拒绝|禁用|阻止)/i, generate: () => false, priority: 8 },
];

/**
 * 日期时间类型值生成规则
 */
const DATETIME_RULES: ValueGenerationRule[] = [
  { pattern: /birth.*?(?:date|day)|birthday/i, generate: () => '1990-01-15', priority: 10 },
  { pattern: /(?:created|registered|signup|joined).*?(?:date|at|time)/i, generate: () => '2024-01-01T10:00:00Z', priority: 9 },
  { pattern: /(?:expir|expire|expiry|expires).*?(?:date|at|time)/i, generate: () => '2025-12-31', priority: 9 },
  { pattern: /(?:updated|modified|changed).*?(?:date|at|time)/i, generate: () => '2024-06-15T14:30:00Z', priority: 9 },
  { pattern: /(?:date|time|timestamp)$/i, generate: () => new Date().toISOString().split('T')[0], priority: 4 },
  // 中文日期字段
  { pattern: /出生日期|生日/i, generate: () => '1990-01-15', priority: 10 },
  { pattern: /创建(?:日期|时间)/i, generate: () => '2024-01-01T10:00:00Z', priority: 9 },
  { pattern: /过期(?:日期|时间)/i, generate: () => '2025-12-31', priority: 9 },
];

/**
 * 状态/类型枚举值生成规则
 */
const ENUM_RULES: ValueGenerationRule[] = [
  { pattern: /account.*?status/i, generate: () => 'ACTIVE', priority: 9 },
  { pattern: /employment.*?(?:status|type)/i, generate: () => 'EMPLOYED', priority: 9 },
  { pattern: /marital.*?status/i, generate: () => 'MARRIED', priority: 9 },
  { pattern: /(?:housing|residence).*?(?:status|type)/i, generate: () => 'OWN', priority: 9 },
  { pattern: /status/i, generate: () => 'ACTIVE', priority: 4 },
  { pattern: /type|category|kind/i, generate: () => 'STANDARD', priority: 4 },
  // 中文状态字段
  { pattern: /账户状态/i, generate: () => '活跃', priority: 9 },
  { pattern: /就业状态/i, generate: () => '在职', priority: 9 },
  { pattern: /婚姻状况/i, generate: () => '已婚', priority: 9 },
  { pattern: /状态/i, generate: () => '正常', priority: 4 },
  { pattern: /类型|类别/i, generate: () => '标准', priority: 4 },
];

/**
 * 所有规则（按优先级排序）
 */
const ALL_RULES: ValueGenerationRule[] = [
  ...FINANCIAL_RULES,
  ...INSURANCE_RULES,
  ...PERSONAL_RULES,
  ...VEHICLE_RULES,
  ...HEALTHCARE_RULES,
  ...NUMERIC_RULES,
  ...BOOLEAN_RULES,
  ...DATETIME_RULES,
  ...ENUM_RULES,
].sort((a, b) => b.priority - a.priority);

/**
 * 从规则中生成值
 */
function generateFromRules(fieldName: string): unknown | undefined {
  for (const rule of ALL_RULES) {
    if (rule.pattern.test(fieldName)) {
      return rule.generate();
    }
  }
  return undefined;
}

/**
 * 类型检查辅助函数
 */
function isIntType(typeName: string): boolean {
  return ['int', 'integer', 'long', '整数', '长整数', 'ganzzahl', 'langzahl'].some(
    (t) => typeName.toLowerCase().includes(t)
  );
}

function isFloatType(typeName: string): boolean {
  return ['float', 'double', 'decimal', '小数', '浮点数', 'dezimal'].some(
    (t) => typeName.toLowerCase().includes(t)
  );
}

function isBoolType(typeName: string): boolean {
  return ['bool', 'boolean', '布尔', 'wahrheitswert'].some(
    (t) => typeName.toLowerCase().includes(t)
  );
}

function isTextType(typeName: string): boolean {
  return ['text', 'string', 'str', '文本', '字符串', 'zeichenkette'].some(
    (t) => typeName.toLowerCase().includes(t)
  );
}

function isDateTimeType(typeName: string): boolean {
  return ['date', 'time', 'datetime', 'timestamp', '日期', '时间'].some(
    (t) => typeName.toLowerCase().includes(t)
  );
}

/**
 * 将值转换为目标类型
 */
function coerceToType(value: unknown, typeName: string, typeKind: TypeKind): unknown {
  if (typeKind !== 'primitive') {
    return value;
  }

  if (isIntType(typeName)) {
    if (typeof value === 'number') return Math.round(value);
    if (typeof value === 'string' && !isNaN(Number(value))) return parseInt(value, 10);
    if (typeof value === 'boolean') return value ? 1 : 0;
  }

  if (isFloatType(typeName)) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && !isNaN(Number(value))) return parseFloat(value);
    if (typeof value === 'boolean') return value ? 1.0 : 0.0;
  }

  if (isBoolType(typeName)) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1';
  }

  if (isTextType(typeName)) {
    return String(value);
  }

  return value;
}

/**
 * 生成基础类型的默认值
 */
function generatePrimitiveDefault(typeName: string): unknown {
  if (isIntType(typeName)) return 0;
  if (isFloatType(typeName)) return 0.0;
  if (isBoolType(typeName)) return false;
  if (isDateTimeType(typeName)) return new Date().toISOString().split('T')[0];
  return '';
}

/**
 * 生成类型的默认值
 */
function generateDefaultValue(typeName: string, typeKind: TypeKind): unknown {
  switch (typeKind) {
    case 'struct':
      return {};
    case 'list':
      return [];
    case 'map':
      return {};
    case 'option':
      return null;
    case 'primitive':
      return generatePrimitiveDefault(typeName);
    default:
      return '';
  }
}

/**
 * 根据字段名和类型生成示例值
 */
export function generateFieldValue(
  fieldName: string,
  typeName: string,
  typeKind: TypeKind = 'primitive'
): unknown {
  // 1. 尝试根据字段名匹配规则生成值
  const ruleBasedValue = generateFromRules(fieldName);
  if (ruleBasedValue !== undefined) {
    return coerceToType(ruleBasedValue, typeName, typeKind);
  }

  // 2. 根据类型生成默认值
  return generateDefaultValue(typeName, typeKind);
}

/**
 * 为完整的参数列表生成输入值
 */
export function generateInputValues(
  parameters: ParameterInfo[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const param of parameters) {
    if (param.typeKind === 'struct' && param.fields) {
      const structValue: Record<string, unknown> = {};
      for (const field of param.fields) {
        structValue[field.name] = generateFieldValue(
          field.name,
          field.type,
          field.typeKind
        );
      }
      result[param.name] = structValue;
    } else if (param.typeKind === 'list') {
      result[param.name] = [generateFieldValue(param.name, param.type, 'primitive')];
    } else {
      result[param.name] = generateFieldValue(param.name, param.type, param.typeKind);
    }
  }

  return result;
}

/**
 * 初始化表单值（带自动生成的示例数据）
 */
export function initFormValuesWithSampleData(
  parameters: ParameterInfo[]
): Record<string, Record<string, unknown>> {
  const values: Record<string, Record<string, unknown>> = {};

  for (const param of parameters) {
    if (param.typeKind === 'struct' && param.fields) {
      const structValue: Record<string, unknown> = {};
      for (const field of param.fields) {
        structValue[field.name] = generateFieldValue(
          field.name,
          field.type,
          field.typeKind
        );
      }
      values[param.name] = structValue;
    } else {
      values[param.name] = generateFieldValue(
        param.name,
        param.type,
        param.typeKind
      ) as Record<string, unknown>;
    }
  }

  return values;
}
