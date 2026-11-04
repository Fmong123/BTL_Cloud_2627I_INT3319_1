"""Cognito is the identity source; DynamoDB stores profile data, never credentials."""
from ..db import call_dynamodb, require_table, serialize_item, utc_timestamp


class UserProfiles:
    def __init__(self, client, table):
        require_table(client, table)
        self.client, self.table = client, table

    def sync(self, account: dict, *, login=False):
        now = utc_timestamp()
        values = {
            ":name": account["name"], ":username": account["username"],
            ":role": account.get("role") or "", ":active": account["active"],
            ":status": account.get("status", "CONFIRMED"), ":now": now,
        }
        names = {"#name": "name", "#role": "role", "#status": "cognito_status"}
        expression = (
            "SET #name=:name, username=:username, #role=:role, active=:active, "
            "#status=:status, updated_at=:now, created_at=if_not_exists(created_at,:now)"
        )
        if login:
            expression += ", last_login_at=:now"
        if "email" in account:
            expression += ", email=:email"
            values[":email"] = account["email"]
        call_dynamodb(
            self.client, "update_item", TableName=self.table,
            Key=serialize_item({"user_id": account["id"]}),
            UpdateExpression=expression, ExpressionAttributeNames=names,
            ExpressionAttributeValues=serialize_item(values),
        )
