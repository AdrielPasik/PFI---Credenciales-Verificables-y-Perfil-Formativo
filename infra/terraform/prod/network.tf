# ---------------------------------------------------------------------------
# VPC
#
# Topology: two public subnets (ALB + Fargate tasks) and two private subnets
# reserved for the RDS subnet group. There is NO NAT Gateway: tasks reach the
# internet through the Internet Gateway using their own public IP, and their
# application ports stay unreachable because the security groups only admit the
# previous hop. S3 traffic stays on the AWS network through a free gateway
# endpoint.
# ---------------------------------------------------------------------------

resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr

  # Required so the Cloud Map private DNS namespace resolves inside the VPC.
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${local.name_prefix}-vpc"
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-igw"
  }
}

resource "aws_subnet" "public" {
  count = length(var.public_subnet_cidrs)

  vpc_id            = aws_vpc.main.id
  cidr_block        = var.public_subnet_cidrs[count.index]
  availability_zone = var.availability_zones[count.index]

  # Public IPs are assigned explicitly by the ECS service network configuration,
  # not implicitly by the subnet.
  map_public_ip_on_launch = false

  tags = {
    Name = "${local.name_prefix}-public-${var.availability_zones[count.index]}"
    Tier = "public"
  }
}

resource "aws_subnet" "database" {
  count = length(var.database_subnet_cidrs)

  vpc_id            = aws_vpc.main.id
  cidr_block        = var.database_subnet_cidrs[count.index]
  availability_zone = var.availability_zones[count.index]

  map_public_ip_on_launch = false

  tags = {
    Name = "${local.name_prefix}-db-${var.availability_zones[count.index]}"
    Tier = "database"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "${local.name_prefix}-public-rt"
  }
}

# No default route: the database subnets have no path to or from the internet.
resource "aws_route_table" "database" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-db-rt"
  }
}

resource "aws_route_table_association" "public" {
  count = length(aws_subnet.public)

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "database" {
  count = length(aws_subnet.database)

  subnet_id      = aws_subnet.database[count.index].id
  route_table_id = aws_route_table.database.id
}

# Gateway endpoint for S3: no hourly charge, no data processing charge, and it
# keeps DocumentEvidence traffic off the public path even though the tasks have
# public IPs. Only same-region S3 is affected, which matches the bucket region.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"

  route_table_ids = [
    aws_route_table.public.id,
    aws_route_table.database.id,
  ]

  tags = {
    Name = "${local.name_prefix}-s3-gateway-endpoint"
  }
}
